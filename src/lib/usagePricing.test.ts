import { describe, expect, it } from "vitest"
import { DEFAULT_PRICES, PriceBook, costOf, familyOf, parsePriceOverrides } from "./usagePricing"

describe("familyOf", () => {
  it("モデルIDから系統を判定する(大文字小文字を区別しない)", () => {
    expect(familyOf("claude-opus-5-5")).toBe("opus")
    expect(familyOf("claude-Sonnet-5")).toBe("sonnet")
    expect(familyOf("claude-haiku-5-5")).toBe("haiku")
    expect(familyOf("claude-fable-5")).toBe("fable")
    expect(familyOf("<synthetic>")).toBeNull()
    expect(familyOf("gpt-unknown")).toBeNull()
  })
})

describe("PriceBook.resolve", () => {
  const book = new PriceBook()

  it("表にあるモデルIDは、そのまま引く", () => {
    expect(book.resolve("claude-opus-5-5")).toEqual({ price: DEFAULT_PRICES["claude-opus-5-5"], via: "exact" })
    expect(book.resolve("CLAUDE-SONNET-5-5").via).toBe("exact")
  })

  it("表にないIDは、系統の最新の価格で引く(claude-opus-4-8 → opus-5-5、claude-sonnet-5 → sonnet-5-5)", () => {
    expect(book.resolve("claude-opus-4-8")).toEqual({ price: DEFAULT_PRICES["claude-opus-5-5"], via: "family" })
    expect(book.resolve("claude-sonnet-5")).toEqual({ price: DEFAULT_PRICES["claude-sonnet-5-5"], via: "family" })
    expect(book.resolve("claude-fable-5")).toEqual({ price: DEFAULT_PRICES["claude-fable-5-1"], via: "family" })
  })

  it("系統も分からないモデルは、opusの価格で仮に計算し、未登録として知らせる", () => {
    expect(book.resolve("some-other-model")).toEqual({ price: DEFAULT_PRICES["claude-opus-5-5"], via: "none" })
  })

  it("設定ファイルの価格は、既定より優先される(IDで直接・系統名で・新しいIDの追加)", () => {
    const custom = new PriceBook(
      parsePriceOverrides({
        "claude-opus-5-5": { input: 1, output: 2, cacheRead: 0.1 },
        sonnet: { input: 3, output: 6, cacheRead: 0.3 },
        "claude-haiku-6-0": { input: 0.5, output: 1, cacheRead: 0.05 },
      })
    )
    expect(custom.resolve("claude-opus-5-5").price.input).toBe(1)
    // 系統名の指定は、表にある系統の最新より優先される
    expect(custom.resolve("claude-sonnet-5-5").price.input).toBe(2) // IDが表にあるので、そのIDの価格
    expect(custom.resolve("claude-sonnet-4-1").price.input).toBe(3)
    // 追加したIDが、系統の最新になる
    expect(custom.resolve("claude-haiku-5-9")).toMatchObject({ via: "family" })
    expect(custom.resolve("claude-haiku-5-9").price.input).toBe(0.5)
  })

  it("設定ファイルの不正な項目(数値でない・負の値)は無視する", () => {
    const overrides = parsePriceOverrides({
      "claude-opus-5-5": { input: "x", output: 2, cacheRead: 0.1 },
      "claude-sonnet-5-5": { input: -1, output: 2, cacheRead: 0.1 },
      bad: null,
      ok: { input: 1, output: 2, cacheRead: 0.1 },
    })
    expect(Object.keys(overrides)).toEqual(["ok"])
  })
})

describe("costOf", () => {
  const price = { input: 4, output: 20, cacheRead: 0.2 }

  it("入力・出力・キャッシュ読み取りを、100万トークンあたりの単価で換算する", () => {
    const cost = costOf({ input: 1_000_000, output: 500_000, cacheRead: 2_000_000, cacheWrite5m: 0, cacheWrite1h: 0 }, price)
    expect(cost).toBeCloseTo(4 + 10 + 0.4, 10)
  })

  it("キャッシュ作成は、5分が入力の1.25倍・1時間が2倍", () => {
    expect(costOf({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 1_000_000, cacheWrite1h: 0 }, price)).toBeCloseTo(5, 10)
    expect(costOf({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 1_000_000 }, price)).toBeCloseTo(8, 10)
  })
})
