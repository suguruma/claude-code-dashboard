import { describe, expect, it } from "vitest"
import { autodetectStoppedNote, dataLocationText } from "./dataLocationText"
import { displayUsageLevel, formatPercent, guardEstimateNote, shownPercent } from "./usageFormat"
import { createUsageNotifyTracker } from "./usageNotifications"
import type { UsageGuard, UsageWindowView } from "./usageTypes"

// ⑧-2 の直し(丸めと色・帯の%・読んでいる場所の文言)の表

function windowView(o: Partial<UsageWindowView> & { percent: number | null; estimated?: boolean }): UsageWindowView {
  const { percent, estimated = true, ...rest } = o
  return {
    id: "five_hour",
    key: "five_hour",
    label: "5時間",
    modelName: null,
    windowStart: null,
    resetsAt: Date.UTC(2026, 9, 18, 14, 0, 0),
    official: null,
    previousOfficial: null,
    estimate: estimated && percent !== null ? { kind: "estimate", percent, low: percent, high: percent } : { kind: "none", reason: "no-official" },
    displayPercent: percent,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    costUsd: 0,
    calibration: null,
    pace: null,
    ...rest,
  }
}

describe("表示する丸めた値で色を決める（displayUsageLevel）", () => {
  it.each([
    [79.4, "79", "ok"],
    [79.5, "80", "warning"],
    [89.4, "89", "warning"],
    [89.5, "90", "serious"],
    [94.4, "94", "serious"],
    [94.5, "95", "critical"],
    [94.6, "95", "critical"],
    [95, "95", "critical"],
    [9.94, "9.9", "ok"],
  ])("%s は「%s%」と出し、色は %s", (value, shown, level) => {
    expect(formatPercent(value)).toBe(shown)
    expect(shownPercent(value)).toBe(Number(shown))
    expect(displayUsageLevel(value)).toBe(level)
  })

  it("値が無ければ通常", () => {
    expect(displayUsageLevel(null)).toBe("ok")
  })
})

describe("通知も表示と同じ丸めで判定する", () => {
  it("94.6（「95%」と表示）で95%の通知が出る", () => {
    const tracker = createUsageNotifyTracker()
    expect(tracker.update({ windows: [windowView({ percent: 90 })], extraUsage: null, generatedAt: 0 })).toEqual([])
    const items = tracker.update({ windows: [windowView({ percent: 94.6 })], extraUsage: null, generatedAt: 0 })
    expect(items.map((i) => i.title)).toEqual(["利用上限: 5時間が95%を超えました"])
  })

  it("79.4（「79%」と表示）では80%の通知は出ない", () => {
    const tracker = createUsageNotifyTracker()
    tracker.update({ windows: [windowView({ percent: 70 })], extraUsage: null, generatedAt: 0 })
    expect(tracker.update({ windows: [windowView({ percent: 79.4 })], extraUsage: null, generatedAt: 0 })).toEqual([])
  })
})

describe("上限ガードの帯に添える推定（guardEstimateNote）", () => {
  const guard: UsageGuard = { level: "high", windowLabel: "5時間", percent: 92 }

  it("推定の丸めた値が公式値と違えば、推定の%を添える", () => {
    expect(guardEstimateNote(guard, [windowView({ percent: 94.8 })])).toBe("ゲージ・カードは推定 95%")
  })

  it("丸めた値が同じなら添えない", () => {
    expect(guardEstimateNote(guard, [windowView({ percent: 92.3 })])).toBeNull()
  })

  it("表示用の値が公式値（推定ではない）なら添えない", () => {
    expect(guardEstimateNote(guard, [windowView({ percent: 95, estimated: false })])).toBeNull()
  })

  it("帯が出ていない・根拠の窓が無い・一覧が無いときは null", () => {
    expect(guardEstimateNote({ level: "none", windowLabel: null, percent: null }, [windowView({ percent: 95 })])).toBeNull()
    expect(guardEstimateNote(guard, [windowView({ percent: 95, label: "週（全モデル）" })])).toBeNull()
    expect(guardEstimateNote(guard, undefined)).toBeNull()
  })
})

describe("読んでいるデータの場所の文言（dataLocationText）", () => {
  it.each([
    [{ path: "X", origin: "explicit-config" as const }, "設定ファイル（config/desktop-sessions.json）で指定したフォルダ"],
    [{ path: null, origin: "explicit-config" as const }, "設定ファイル（config/desktop-sessions.json）で指定したフォルダ（見つかりません）"],
    [{ path: "X", origin: "explicit-env" as const }, "環境変数 CLAUDE_DESKTOP_DATA_DIR で指定したフォルダ"],
    [{ path: "X", origin: "auto" as const }, "自動で見つけたフォルダ"],
    [{ path: null, origin: "auto" as const }, "自動で探しましたが、見つかりません"],
    [{ path: null, origin: "disabled" as const }, "自動で探すのを止めています（CCD_DESKTOP_AUTODETECT=0）。設定ファイルか環境変数で指定したフォルダだけを読みます"],
  ])("%j", (location, tail) => {
    expect(dataLocationText(location)).toBe(`読んでいる Claude Desktop のデータ：${tail}`)
  })

  it("スイッチで止めているときだけ、見つからない枠に一言添える（⑧-3）", () => {
    expect(autodetectStoppedNote({ path: null, origin: "disabled" })).toContain("CCD_DESKTOP_AUTODETECT=0")
    for (const origin of ["explicit-config", "explicit-env", "auto"] as const) {
      expect(autodetectStoppedNote({ path: null, origin })).toBeNull()
    }
  })

  it("文言に場所（パス）を入れない", () => {
    expect(dataLocationText({ path: "C:\\secret\\place", origin: "auto" })).not.toContain("secret")
  })
})

describe("撮影の前の確認（scripts/check-sample-server.mjs）", () => {
  type Check = (response: unknown, expected: unknown) => string[]
  async function load(): Promise<Check> {
    const { pathToFileURL } = await import("url")
    const path = await import("path")
    const mod = (await import(/* @vite-ignore */ pathToFileURL(path.join(process.cwd(), "scripts", "check-sample-server.mjs")).href)) as {
      checkSampleResponse: Check
    }
    return mod.checkSampleResponse
  }
  const ids = (n: number, prefix = "s") => Array.from({ length: n }, (_, i) => `${prefix}${i}`)
  const sessions = (n: number, prefix = "s") => ids(n, prefix).map((id) => ({ id }))
  const expected20 = { sessionCount: 20, sessionIds: ids(20) }
  const explicit = { origin: "explicit-config", path: "X" }

  it("出どころが明示で、件数と ID が期待どおりなら合格", async () => {
    const check = await load()
    expect(check({ dataLocation: explicit, sessions: sessions(20) }, expected20)).toEqual([])
    expect(check({ dataLocation: { origin: "explicit-env", path: "X" }, sessions: sessions(20) }, expected20)).toEqual([])
  })

  it.each(["auto", "disabled", undefined])("出どころが %s なら止める", async (origin) => {
    const check = await load()
    expect(check({ dataLocation: origin ? { origin, path: null } : undefined, sessions: sessions(20) }, expected20)).toHaveLength(1)
  })

  it("件数が違えば止める。期待値が無くても止める", async () => {
    const check = await load()
    expect(check({ dataLocation: explicit, sessions: sessions(48) }, expected20)[0]).toContain("48件")
    expect(check({ dataLocation: explicit, sessions: sessions(20) }, { sessionIds: ids(20) })).toHaveLength(1)
  })

  it("件数がちょうど同じでも、ID が合成データと違えば止める（⑧-3）", async () => {
    const check = await load()
    const problems = check({ dataLocation: explicit, sessions: sessions(20, "real") }, expected20)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("ID が合成データと一致しません")
    // 1件だけ入れ替わっていても止める。メッセージに ID そのものは出さない
    const mixed = [...sessions(19), { id: "real-x" }]
    const one = check({ dataLocation: explicit, sessions: mixed }, expected20)
    expect(one[0]).toContain("合成データに無い ID 1件")
    expect(one[0]).not.toContain("real-x")
  })

  it("expected.json に ID の一覧が無ければ止める（古い合成データ）", async () => {
    const check = await load()
    expect(check({ dataLocation: explicit, sessions: sessions(20) }, { sessionCount: 20 })[0]).toContain("sessionIds")
  })
})
