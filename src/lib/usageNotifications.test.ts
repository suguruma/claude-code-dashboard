import { describe, expect, it } from "vitest"
import { buildUsageNotification, createUsageNotifyTracker } from "./usageNotifications"
import type { UsageResponse, UsageWindowView } from "./usageTypes"

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0)
const HOUR = 60 * 60 * 1000

function window(id: string, percent: number | null, resetsAt: number | null, label = "5時間", estimated = true): UsageWindowView {
  return {
    id,
    key: id.startsWith("weekly_model") ? "weekly_model" : (id as UsageWindowView["key"]),
    label,
    modelName: null,
    windowStart: null,
    resetsAt,
    official: null,
    previousOfficial: null,
    estimate: estimated && percent !== null ? { kind: "estimate", percent, low: percent, high: percent } : { kind: "none", reason: "no-official" },
    displayPercent: percent,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    costUsd: 0,
    calibration: null,
    pace: null,
  }
}

function response(windows: UsageWindowView[], extraEnabled = false, at = NOW): Pick<UsageResponse, "windows" | "extraUsage" | "generatedAt"> {
  return { windows, extraUsage: { enabled: extraEnabled, spent: null }, generatedAt: at }
}

describe("createUsageNotifyTracker", () => {
  const resets = NOW + 2 * HOUR

  it("最初の取得は基準を取るだけで、すでに超えていたものを通知しない", () => {
    const tracker = createUsageNotifyTracker()
    expect(tracker.update(response([window("five_hour", 85, resets), window("weekly_all", 96, NOW + 3 * 24 * HOUR, "週（全モデル）")]))).toEqual([])
    expect(tracker.update(response([window("five_hour", 86, resets)]))).toEqual([])
  })

  it("80%を超えたときと、95%を超えたときに、それぞれ1回だけ通知する", () => {
    const tracker = createUsageNotifyTracker()
    tracker.update(response([window("five_hour", 70, resets)]))
    const at80 = tracker.update(response([window("five_hour", 81, resets)]))
    expect(at80).toHaveLength(1)
    expect(at80[0].title).toBe("利用上限: 5時間が80%を超えました")
    expect(at80[0].sessionId).toBeNull()
    // 同じしきい値の間は、何度取得しても通知しない
    expect(tracker.update(response([window("five_hour", 84, resets)]))).toEqual([])
    const at95 = tracker.update(response([window("five_hour", 96, resets)]))
    expect(at95.map((n) => n.title)).toEqual(["利用上限: 5時間が95%を超えました"])
    expect(tracker.update(response([window("five_hour", 99, resets)]))).toEqual([])
  })

  it("80%と95%を一度に飛び越えたときは、高い方の1件だけ通知する", () => {
    const tracker = createUsageNotifyTracker()
    tracker.update(response([window("five_hour", 50, resets)]))
    const items = tracker.update(response([window("five_hour", 97, resets)]))
    expect(items.map((n) => n.title)).toEqual(["利用上限: 5時間が95%を超えました"])
  })

  it("一度通知したしきい値は、推定が下がってまた超えても再通知しない", () => {
    const tracker = createUsageNotifyTracker()
    tracker.update(response([window("five_hour", 50, resets)]))
    expect(tracker.update(response([window("five_hour", 82, resets)]))).toHaveLength(1)
    expect(tracker.update(response([window("five_hour", 78, resets)]))).toEqual([])
    expect(tracker.update(response([window("five_hour", 83, resets)]))).toEqual([])
  })

  it("枠が切り替わったら(resetsAtが変わったら)、新しい枠として数え直す。resetsAtの秒の端数のずれは同じ枠とみなす", () => {
    const tracker = createUsageNotifyTracker()
    tracker.update(response([window("five_hour", 50, resets)]))
    expect(tracker.update(response([window("five_hour", 82, resets + 523)]))).toHaveLength(1)
    expect(tracker.update(response([window("five_hour", 83, resets - 400)]))).toEqual([])
    // 次の枠(5時間後)で、また80%を超えたら通知する
    const next = resets + 5 * HOUR
    expect(tracker.update(response([window("five_hour", 10, next)]))).toEqual([])
    expect(tracker.update(response([window("five_hour", 81, next)]))).toHaveLength(1)
  })

  it("窓ごとに数える(5時間と週は別々に通知する)", () => {
    const tracker = createUsageNotifyTracker()
    const week = NOW + 4 * 24 * HOUR
    tracker.update(response([window("five_hour", 10, resets), window("weekly_all", 10, week, "週（全モデル）")]))
    const items = tracker.update(response([window("five_hour", 81, resets), window("weekly_all", 82, week, "週（全モデル）")]))
    expect(items.map((n) => n.title)).toEqual(["利用上限: 5時間が80%を超えました", "利用上限: 週（全モデル）が80%を超えました"])
  })

  it("%が分からない窓・枠の終わりが分からない窓は対象にしない", () => {
    const tracker = createUsageNotifyTracker()
    tracker.update(response([window("five_hour", 10, resets)]))
    expect(tracker.update(response([window("five_hour", null, resets), window("weekly_all", 90, null)]))).toEqual([])
  })

  it("reset すると基準を取り直し、オンにした時点で超えていたものを通知しない", () => {
    const tracker = createUsageNotifyTracker()
    tracker.update(response([window("five_hour", 10, resets)]))
    tracker.reset()
    expect(tracker.update(response([window("five_hour", 90, resets)]))).toEqual([])
    expect(tracker.update(response([window("five_hour", 91, resets)]))).toEqual([])
  })
})

describe("buildUsageNotification", () => {
  it("本文は、推定か公式値かと、%と、リセットまでの時間だけ。会話・セッションの情報は含めない", () => {
    const n = buildUsageNotification(window("five_hour", 82.4, NOW + 90 * 60 * 1000), 80, NOW, false)
    expect(n.title).toBe("利用上限: 5時間が80%を超えました")
    expect(n.body).toBe("推定 82%、リセットまで1時間30分")
  })

  it("公式値だけのときは「公式値」と出す", () => {
    const n = buildUsageNotification(window("five_hour", 81, NOW + HOUR, "5時間", false), 80, NOW, false)
    expect(n.body.startsWith("公式値 81%")).toBe(true)
  })

  it("追加利用がオンで95%を超えたときは、課金が始まる旨を添える", () => {
    expect(buildUsageNotification(window("five_hour", 96, NOW + HOUR), 95, NOW, true).body).toContain("課金が始まります")
    expect(buildUsageNotification(window("five_hour", 81, NOW + HOUR), 80, NOW, true).body).not.toContain("課金")
    expect(buildUsageNotification(window("five_hour", 96, NOW + HOUR), 95, NOW, false).body).not.toContain("課金")
  })
})
