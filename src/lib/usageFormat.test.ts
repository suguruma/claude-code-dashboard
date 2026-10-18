import { describe, expect, it } from "vitest"
import {
  costPerPercentOf,
  formatDollars,
  formatJst,
  formatJstTime,
  formatLimitShare,
  formatPercent,
  formatRemaining,
  formatTokens,
  usageLevel,
} from "./usageFormat"

describe("usageLevel", () => {
  it("80%で黄、90%で橙、95%で赤。%が無ければ通常", () => {
    expect(usageLevel(null)).toBe("ok")
    expect(usageLevel(79.9)).toBe("ok")
    expect(usageLevel(80)).toBe("warning")
    expect(usageLevel(89.9)).toBe("warning")
    expect(usageLevel(90)).toBe("serious")
    expect(usageLevel(94.9)).toBe("serious")
    expect(usageLevel(95)).toBe("critical")
    expect(usageLevel(120)).toBe("critical")
  })
})

describe("formatRemaining", () => {
  const MIN = 60_000
  it("あと何時間何分。1日以上は日と時間。過ぎていればまもなくリセット", () => {
    expect(formatRemaining(0)).toBe("まもなくリセット")
    expect(formatRemaining(-5 * MIN)).toBe("まもなくリセット")
    expect(formatRemaining(30 * 1000)).toBe("あと1分")
    expect(formatRemaining(45 * MIN)).toBe("あと45分")
    expect(formatRemaining(133 * MIN)).toBe("あと2時間13分")
    expect(formatRemaining((5 * 24 * 60 + 12 * 60 + 30) * MIN)).toBe("あと5日12時間")
  })
})

describe("日本時間の表示", () => {
  it("UTCのmsを日本時間(UTC+9)の「月/日 時:分」にする", () => {
    const utc = Date.UTC(2026, 9, 18, 16, 5) // 日本時間では10/19 01:05
    expect(formatJst(utc)).toBe("10/19 01:05")
    expect(formatJstTime(utc)).toBe("01:05")
  })
})

describe("数値の整形", () => {
  it("金額・トークン数・%", () => {
    expect(formatDollars(1.234)).toBe("$1.23")
    expect(formatDollars(12.34)).toBe("$12.3")
    expect(formatDollars(234.5)).toBe("$235")
    expect(formatTokens(412)).toBe("412")
    expect(formatTokens(57_800)).toBe("58K")
    expect(formatTokens(2_600_000)).toBe("2.6M")
    expect(formatPercent(5.55)).toBe("5.5")
    expect(formatPercent(47.4)).toBe("47")
  })
})

describe("積み上げ棒の値（上限の何%）", () => {
  const calibration = { costPerPercentLow: 1.8, costPerPercentHigh: 2.2, mode: "intersect" as const, samples: 3 }

  it("係数は範囲の中央値。上限の無い範囲・較正なしは null", () => {
    expect(costPerPercentOf(calibration)).toBeCloseTo(2, 5)
    expect(costPerPercentOf({ ...calibration, costPerPercentHigh: null })).toBeNull()
    expect(costPerPercentOf(null)).toBeNull()
    expect(costPerPercentOf({ ...calibration, costPerPercentLow: 0, costPerPercentHigh: 0 })).toBeNull()
  })

  it("係数があれば「上限の約X%」（金額÷係数）。ドルは出さない", () => {
    expect(formatLimitShare(6, 20, 2)).toBe("上限の約3.0%")
    expect(formatLimitShare(40, 100, 2)).toBe("上限の約20%")
    expect(formatLimitShare(0.1, 100, 2)).toBe("上限の0.1%未満")
    expect(formatLimitShare(6, 20, 2)).not.toContain("$")
  })

  it("係数が決まらないときは、全体に占める割合", () => {
    expect(formatLimitShare(5, 20, null)).toBe("全体の25%")
    expect(formatLimitShare(0.01, 100, null)).toBe("全体の0.1%未満")
    expect(formatLimitShare(0, 0, null)).toBe("全体の0.1%未満")
  })
})
