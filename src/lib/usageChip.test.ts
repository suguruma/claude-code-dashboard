import { describe, expect, it } from "vitest"
import { chipHold, chipLabel, resetShort, sortWindows, tightestWindow } from "./usageChip"
import type { UsageResponse, UsageWindowView } from "./usageTypes"

// 値はどれも合成
const NOW = 1_800_000_000_000
const win = (key: UsageWindowView["key"], displayPercent: number | null, modelName: string | null = null): UsageWindowView =>
  ({
    id: modelName ? `weekly_model:${modelName}` : key,
    key,
    label: key === "five_hour" ? "5時間" : key === "weekly_all" ? "週（全モデル）" : `週（${modelName}）`,
    modelName,
    resetsAt: NOW + 72 * 60_000,
    displayPercent,
    estimate: { kind: "none", reason: "no-official" },
  }) as unknown as UsageWindowView
const usage = (windows: UsageWindowView[], guard: UsageResponse["guard"] | null = null): UsageResponse => ({ generatedAt: NOW, windows, guard }) as unknown as UsageResponse

describe("[OR-1] 利用上限の札", () => {
  it("「！ 控える」はホームの帯と同じ式：上限ガード中、または 5時間・週の表示の値が80%以上(79%・80%・ガード中)", () => {
    expect(chipHold(usage([win("five_hour", 79), win("weekly_all", 41)]))).toBe(false)
    expect(chipHold(usage([win("five_hour", 80), win("weekly_all", 41)]))).toBe(true)
    expect(chipHold(usage([win("five_hour", 20), win("weekly_all", 85)]))).toBe(true)
    const guard = { level: "warn", windowLabel: "5時間", percent: 81 } as UsageResponse["guard"]
    expect(chipHold(usage([win("five_hour", 20)], guard))).toBe(true)
    // モデル別の窓は、ホームの帯と同じく判定に入れない
    expect(chipHold(usage([win("five_hour", 20), win("weekly_model", 95, "Fable")]))).toBe(false)
    expect(chipHold(null)).toBe(false)
  })

  it("札は表示の値のいちばん高い窓。小窓はきつい順(同じなら 5時間 → 週 → モデル別。値の無い窓は最後)", () => {
    const ws = [win("weekly_model", 0, "Fable"), win("weekly_all", 41), win("five_hour", 83), win("weekly_model", null, "Opus")]
    expect(tightestWindow(ws)?.key).toBe("five_hour")
    expect(sortWindows(ws).map((w) => w.id)).toEqual(["five_hour", "weekly_all", "weekly_model:Fable", "weekly_model:Opus"])
    expect(sortWindows([win("weekly_all", 50), win("five_hour", 50)]).map((w) => w.key)).toEqual(["five_hour", "weekly_all"])
    expect(tightestWindow([win("five_hour", null)])).toBeNull()
  })

  it("リセットまでは「時:分」、24時間以上は「日と時間」。札の窓の名前は「週（全モデル）」を「週」に縮める", () => {
    expect(resetShort(NOW + 72 * 60_000, NOW)).toBe("1:12")
    expect(resetShort(NOW + 5 * 60_000, NOW)).toBe("0:05")
    expect(resetShort(NOW + (4 * 24 + 21) * 60 * 60_000, NOW)).toBe("4日21時間")
    expect(resetShort(null, NOW)).toBeNull()
    expect(chipLabel(win("weekly_all", 1))).toBe("週")
    expect(chipLabel(win("five_hour", 1))).toBe("5時間")
  })
})
