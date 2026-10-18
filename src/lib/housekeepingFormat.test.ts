import { describe, expect, it } from "vitest"
import { parseHousekeepingConfig } from "./desktopSessionService"
import { describeResumeCost, formatDuration, formatPercentRange } from "./housekeepingFormat"
import type { ResumeCost } from "./housekeepingTypes"

describe("formatPercentRange", () => {
  it("幅があるときは「約x〜y%」。表示上同じ値になるときは「約x%」", () => {
    expect(formatPercentRange({ min: 2.01, max: 2.42 })).toBe("約2.0〜2.4%")
    expect(formatPercentRange({ min: 14.5, max: 18.1 })).toBe("約15〜18%")
    expect(formatPercentRange({ min: 2.01, max: 2.04 })).toBe("約2.0%")
  })

  it("下限が決まらないときは「最大で約y%」", () => {
    expect(formatPercentRange({ min: null, max: 4 })).toBe("最大で約4.0%")
  })

  it("0.1%に満たない値は「0.1%未満」（0.0% と出さない）", () => {
    expect(formatPercentRange({ min: 0.01, max: 0.04 })).toBe("0.1%未満")
    expect(formatPercentRange({ min: null, max: 0.09 })).toBe("0.1%未満")
    expect(formatPercentRange({ min: 0.02, max: 0.3 })).toBe("約0.1〜0.3%")
  })
})

describe("describeResumeCost", () => {
  const cost = (over: Partial<ResumeCost>): ResumeCost => ({ usd: 2.82, fiveHour: null, weekly: null, priceUnregistered: false, ...over })

  it("較正のある枠だけを並べる（5時間 → 週）。金額は「API価格換算」として添える", () => {
    expect(describeResumeCost(cost({ fiveHour: { min: 1.9, max: 2.1 }, weekly: { min: 0.27, max: 0.31 } }))).toEqual({
      shares: ["5時間の枠 約1.9〜2.1%", "週 約0.3%"],
      dollars: "API価格換算 $2.82",
    })
    expect(describeResumeCost(cost({ weekly: { min: 0.27, max: 0.31 } })).shares).toEqual(["週 約0.3%"])
  })

  it("較正が無ければ割合は出さない（金額だけ）", () => {
    expect(describeResumeCost(cost({}))).toEqual({ shares: [], dollars: "API価格換算 $2.82" })
  })
})

describe("formatDuration", () => {
  it("分・時間・日で短く表す", () => {
    expect(formatDuration(20_000)).toBe("1分未満")
    expect(formatDuration(45 * 60_000)).toBe("45分")
    expect(formatDuration(60 * 60_000)).toBe("1時間")
    expect(formatDuration(192 * 60_000)).toBe("3時間12分")
    expect(formatDuration(24 * 60 * 60_000)).toBe("1日")
    expect(formatDuration((53 * 60) * 60_000)).toBe("2日5時間")
    expect(formatDuration(-5)).toBe("1分未満")
  })
})

describe("parseHousekeepingConfig（config/desktop-sessions.json の housekeeping）", () => {
  it("分は ms に直して読む。正の数でない項目・知らない項目は無視する", () => {
    expect(parseHousekeepingConfig({ idleMinutes: 90, minIdleTokens: 100_000, unansweredMinutes: 15 })).toEqual({
      idleMs: 90 * 60_000,
      minIdleTokens: 100_000,
      unansweredMs: 15 * 60_000,
    })
    expect(parseHousekeepingConfig({ idleMinutes: 0, minIdleTokens: -1, unansweredMinutes: "30", other: 1 })).toEqual({})
    expect(parseHousekeepingConfig({ idleMinutes: Number.NaN, minIdleTokens: Number.POSITIVE_INFINITY })).toEqual({})
    expect(parseHousekeepingConfig({})).toEqual({})
  })
})
