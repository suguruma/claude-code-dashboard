import { describe, expect, it } from "vitest"
import { buildContributions, buildUsage, isNearReset, windowLabel } from "./usageEstimate"
import type { UsageRow } from "./usageLedger"
import type { SnapshotWindow, UsageSnapshot } from "./usageSnapshots"
import { PriceBook } from "./usagePricing"

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const NOW = Date.UTC(2026, 9, 18, 12, 0, 0)
const prices = new PriceBook()

let seq = 0

/** opus-5-5(出力 $20/100万トークン)で、ちょうど dollars ドルになる合成の行 */
function row(at: number, dollars: number, overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    id: `msg_test_${++seq}`,
    at,
    model: "claude-opus-5-5",
    sessionKey: "session-a",
    dirName: "proj-a",
    subagent: false,
    input: 0,
    output: Math.round((dollars / 20) * 1_000_000),
    cacheRead: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    ...overrides,
  }
}

function win(key: SnapshotWindow["key"], percentUsed: number, resetsAt: number, modelName: string | null = null): SnapshotWindow {
  return { key, modelName, label: key, percentUsed, resetsAt }
}

function snap(ts: number, windows: SnapshotWindow[]): UsageSnapshot {
  return { ts, plan: "Pro", windows, extraUsage: { enabled: false, spent: null } }
}

function only<T>(items: T[]): T {
  expect(items).toHaveLength(1)
  return items[0]
}

describe("windowLabel", () => {
  it("窓の名前", () => {
    expect(windowLabel({ key: "five_hour", modelName: null })).toBe("5時間")
    expect(windowLabel({ key: "weekly_all", modelName: null })).toBe("週（全モデル）")
    expect(windowLabel({ key: "weekly_model", modelName: "Fable" })).toBe("週（Fable）")
  })
})

describe("buildUsage: 較正と推定", () => {
  // 5時間の枠: resetsAt = NOW+2h なので、始まりは NOW-3h
  const resetsAt = NOW + 2 * HOUR

  it("公式値が1点なら、丸め(±0.5)から係数の範囲を出し、その後に増えた金額を足して、幅つきで推定する", () => {
    // 窓の始まりから記録まで $10 を使って 10% → 1%あたり約$1。記録の後に $2 増えた
    const rows = [row(NOW - 2 * HOUR, 10), row(NOW - 30 * MIN, 2)]
    const out = buildUsage({ now: NOW, snapshots: [snap(NOW - HOUR, [win("five_hour", 10, resetsAt)])], rows, prices })
    const w = only(out.windows)
    expect(w.calibration).toMatchObject({ mode: "single", samples: 1 })
    expect(w.calibration?.costPerPercentLow).toBeCloseTo(10 / 10.5, 6)
    expect(w.calibration?.costPerPercentHigh).toBeCloseTo(10 / 9.5, 6)
    expect(w.estimate.kind).toBe("estimate")
    if (w.estimate.kind !== "estimate") return
    const mid = (10 / 10.5 + 10 / 9.5) / 2
    expect(w.estimate.percent).toBeCloseTo(10 + 2 / mid, 6)
    expect(w.estimate.low).toBeCloseTo(9.5 + 2 / (10 / 9.5), 6)
    expect(w.estimate.high).toBeCloseTo(10.5 + 2 / (10 / 10.5), 6)
    expect(w.official).toEqual({ percentUsed: 10, recordedAt: NOW - HOUR, resetsAt })
    expect(w.displayPercent).toBeCloseTo(w.estimate.percent, 10)
    expect(w.costUsd).toBeCloseTo(12, 6)
  })

  it("公式値が複数あれば、係数の範囲を重ねて絞る", () => {
    const rows = [row(NOW - 2 * HOUR, 10), row(NOW - 100 * MIN, 10)]
    const snapshots = [
      snap(NOW - 110 * MIN, [win("five_hour", 10, resetsAt)]), // $10 → 10%
      snap(NOW - 90 * MIN, [win("five_hour", 20, resetsAt)]), // $20 → 20%
    ]
    const out = buildUsage({ now: NOW, snapshots, rows, prices })
    const cal = only(out.windows).calibration
    expect(cal?.mode).toBe("intersect")
    expect(cal?.samples).toBe(2)
    // 1点目の範囲 [0.952, 1.053] と 2点目 [0.976, 1.026] の重なりは、どちらより狭い
    expect((cal?.costPerPercentHigh ?? 0) - (cal?.costPerPercentLow ?? 0)).toBeLessThan(10 / 9.5 - 10 / 10.5)
  })

  it("重ならない公式値(記録に残らない利用があった等)は外れ値として使わず、新しい公式値の範囲を採る", () => {
    // 古い記録: $10 で 40% (1%あたり$0.25)。新しい記録: 新しい枠の中の$10 で 20% (1%あたり$0.5)。係数が2倍違い、重ならない
    const rows = [row(NOW - 4 * HOUR, 10), row(NOW - 100 * MIN, 10)]
    const snapshots = [
      snap(NOW - 4 * HOUR + MIN, [win("five_hour", 40, NOW - 2 * HOUR)]),
      snap(NOW - 90 * MIN, [win("five_hour", 20, resetsAt)]),
    ]
    const out = buildUsage({ now: NOW, snapshots, rows, prices })
    const cal = only(out.windows).calibration
    expect(cal?.samples).toBe(1)
    expect(cal?.costPerPercentLow).toBeCloseTo(10 / 20.5, 6)
  })

  it("公式値が0%だけのときは、係数の上限が無い(下限だけ)。推定は下限で控えめに見て、%が大きい側に出す", () => {
    const rows = [row(NOW - 2 * HOUR, 1), row(NOW - 30 * MIN, 1)]
    const out = buildUsage({ now: NOW, snapshots: [snap(NOW - HOUR, [win("five_hour", 0, resetsAt)])], rows, prices })
    const w = only(out.windows)
    expect(w.calibration?.costPerPercentHigh).toBeNull()
    expect(w.calibration?.costPerPercentLow).toBeCloseTo(2, 6)
    expect(w.estimate.kind).toBe("estimate")
    if (w.estimate.kind === "estimate") {
      expect(w.estimate.percent).toBeCloseTo(1 / 2, 6)
      expect(w.estimate.low).toBe(0)
    }
  })

  it("その枠で使った金額が0なら、係数を決められず、推定しない(公式値は出す)", () => {
    const out = buildUsage({ now: NOW, snapshots: [snap(NOW - HOUR, [win("five_hour", 5, resetsAt)])], rows: [], prices })
    const w = only(out.windows)
    expect(w.estimate).toEqual({ kind: "none", reason: "no-calibration" })
    expect(w.official?.percentUsed).toBe(5)
    expect(w.displayPercent).toBe(5)
    expect(w.calibration).toBeNull()
  })

  it("重複行を除いた台帳を前提に、同じ応答を二重に数えない(行を2倍にすると推定も2倍の増分になる)", () => {
    const base = [row(NOW - 2 * HOUR, 10), row(NOW - 30 * MIN, 2)]
    const one = buildUsage({ now: NOW, snapshots: [snap(NOW - HOUR, [win("five_hour", 10, resetsAt)])], rows: base, prices })
    expect(only(one.windows).costUsd).toBeCloseTo(12, 6)
  })
})

describe("buildUsage: 現在の枠", () => {
  it("5時間の枠が切り替わっていれば、前の枠が終わった後の最初のリクエストを新しい枠の始まりにする。公式値が無いので%は出さない", () => {
    const resetsAt = NOW - HOUR // 前の枠は1時間前に終わった
    const rows = [
      row(NOW - 3 * HOUR, 5), // 前の枠の中
      row(NOW - 30 * MIN, 3, { subagent: true, sessionKey: "session-b" }), // 新しい枠の最初(サブエージェントも含める)
      row(NOW - 10 * MIN, 2),
    ]
    const out = buildUsage({ now: NOW, snapshots: [snap(NOW - 2 * HOUR, [win("five_hour", 30, resetsAt)])], rows, prices })
    const w = only(out.windows)
    expect(w.windowStart).toBe(NOW - 30 * MIN)
    expect(w.resetsAt).toBe(NOW - 30 * MIN + 5 * HOUR)
    expect(w.official).toBeNull()
    expect(w.previousOfficial).toMatchObject({ percentUsed: 30 })
    expect(w.estimate).toEqual({ kind: "none", reason: "no-official" })
    expect(w.displayPercent).toBeNull()
    expect(w.costUsd).toBeCloseTo(5, 6) // 新しい枠の中の分だけ
  })

  it("前の枠が終わった後に活動が無ければ、現在の枠は無い", () => {
    const out = buildUsage({
      now: NOW,
      snapshots: [snap(NOW - 6 * HOUR, [win("five_hour", 30, NOW - HOUR)])],
      rows: [row(NOW - 3 * HOUR, 5)],
      prices,
    })
    const w = only(out.windows)
    expect(w.windowStart).toBeNull()
    expect(w.resetsAt).toBeNull()
    expect(w.costUsd).toBe(0)
  })

  it("週の枠が切り替わっていれば、リセット時刻を7日ずつ進める。公式値が無いので%は出さない", () => {
    const resetsAt = NOW - 1 * DAY
    const out = buildUsage({
      now: NOW,
      snapshots: [snap(NOW - 2 * DAY, [win("weekly_all", 50, resetsAt)])],
      rows: [row(NOW - 12 * HOUR, 4)],
      prices,
    })
    const w = only(out.windows)
    expect(w.resetsAt).toBe(resetsAt + 7 * DAY)
    expect(w.windowStart).toBe(resetsAt)
    expect(w.official).toBeNull()
    expect(w.estimate.kind).toBe("none")
    expect(w.costUsd).toBeCloseTo(4, 6)
  })

  it("resetsAtの秒の端数が記録ごとにずれていても、同じ枠として扱う", () => {
    const resets = NOW + 2 * HOUR
    const snapshots = [
      snap(NOW - 100 * MIN, [win("five_hour", 10, resets + 523)]),
      snap(NOW - 50 * MIN, [win("five_hour", 20, resets)]),
    ]
    const rows = [row(NOW - 2 * HOUR, 10), row(NOW - 90 * MIN, 10)]
    const w = only(buildUsage({ now: NOW, snapshots, rows, prices }).windows)
    expect(w.official?.percentUsed).toBe(20)
    expect(w.calibration?.samples).toBe(2)
  })

  it("weekly_model は、message.model に窓のモデル名(大文字小文字を区別しない)を含む行だけで計算する", () => {
    const resets = NOW + 3 * DAY
    const rows = [
      row(NOW - DAY, 8, { model: "claude-fable-5-1" }),
      row(NOW - DAY, 100, { model: "claude-opus-5-5" }),
    ]
    const snapshots = [
      snap(NOW - 12 * HOUR, [win("weekly_all", 10, resets), win("weekly_model", 8, resets, "fable")]),
    ]
    const out = buildUsage({ now: NOW, snapshots, rows, prices })
    const all = out.windows.find((w) => w.key === "weekly_all")
    const fable = out.windows.find((w) => w.key === "weekly_model")
    // row() はopusの単価でdollarsドルになる出力量を作る。fable-5-1の出力単価は$50/100万なので、$8分の出力は$20になる
    expect(all?.costUsd).toBeCloseTo(20 + 100, 6)
    expect(fable?.costUsd).toBeCloseTo(20, 6)
    expect(fable?.label).toBe("週（fable）")
    expect(fable?.tokens.output).toBeGreaterThan(0)
  })

  it("窓は 5時間・週(全モデル)・週(モデル別) の順に並ぶ", () => {
    const resets = NOW + 2 * HOUR
    const out = buildUsage({
      now: NOW,
      snapshots: [snap(NOW - HOUR, [win("weekly_model", 1, resets, "Fable"), win("weekly_all", 1, resets), win("five_hour", 1, resets)])],
      rows: [row(NOW - 2 * HOUR, 1)],
      prices,
    })
    expect(out.windows.map((w) => w.key)).toEqual(["five_hour", "weekly_all", "weekly_model"])
  })

  it("公式値の記録が無ければ窓は空", () => {
    expect(buildUsage({ now: NOW, snapshots: [], rows: [row(NOW - HOUR, 1)], prices }).windows).toEqual([])
  })
})

describe("buildUsage: ペースの予測", () => {
  it("5時間は直近の消費の指数平滑でペースを出し、100%に達する時刻を予測する。リセットより前なら警告できる", () => {
    const resetsAt = NOW + 3 * HOUR // 窓の始まりは NOW-2h
    // 毎分 $0.1 を2時間。1%あたり$1 なので 1分で0.1% = 6%/時
    const rows: UsageRow[] = []
    for (let m = 120; m >= 1; m--) rows.push(row(NOW - m * MIN, 0.1))
    // 記録: 窓の始まりから60分後に $6 で 6%(1%あたり$1)
    const snapshots = [snap(NOW - 60 * MIN, [win("five_hour", 6, resetsAt)])]
    const w = only(buildUsage({ now: NOW, snapshots, rows, prices }).windows)
    expect(w.pace?.basis).toBe("ewma30")
    expect(w.pace?.ratePerHour).toBeGreaterThan(5.5)
    expect(w.pace?.ratePerHour).toBeLessThan(6.5)
    expect(w.pace?.mean60PerHour).toBeGreaterThan(5.5)
    expect(w.pace?.mean60PerHour).toBeLessThan(6.5)
    const pct = w.displayPercent ?? 0
    const hours = (100 - pct) / (w.pace?.ratePerHour ?? 1)
    expect(w.pace?.etaAt).toBeCloseTo(NOW + hours * HOUR, -3)
    // 100%まで約14時間かかるので、3時間後のリセットより後になる
    expect(w.pace?.beforeReset).toBe(false)
  })

  it("リセットより先に100%へ達するペースなら beforeReset が true", () => {
    const resetsAt = NOW + HOUR
    const rows: UsageRow[] = []
    // 毎分 $1 を4時間(窓の始まりは NOW-4h) → 1%あたり約$1とすると60%/時
    for (let m = 60; m >= 1; m--) rows.push(row(NOW - m * MIN, 1))
    rows.unshift(row(NOW - 3 * HOUR, 60))
    const snapshots = [snap(NOW - 61 * MIN, [win("five_hour", 60, resetsAt)])]
    const w = only(buildUsage({ now: NOW, snapshots, rows, prices }).windows)
    expect(w.pace?.beforeReset).toBe(true)
    expect(w.pace?.etaAt).toBeLessThan(resetsAt)
  })

  it("リセットより先に達する予測でも、その差が小さければ nearReset（5時間は15分以内、週は2時間以内）", () => {
    const resets = NOW + 4 * HOUR
    // 5時間の枠
    expect(isNearReset("five_hour", resets - 14 * MIN, resets, 80)).toBe(true)
    expect(isNearReset("five_hour", resets - 15 * MIN, resets, 80)).toBe(true)
    expect(isNearReset("five_hour", resets - 16 * MIN, resets, 80)).toBe(false)
    // 週の枠（全モデル・モデル別とも）
    expect(isNearReset("weekly_all", resets - 2 * HOUR, resets, 80)).toBe(true)
    expect(isNearReset("weekly_all", resets - 2 * HOUR - MIN, resets, 80)).toBe(false)
    expect(isNearReset("weekly_model", resets - HOUR, resets, 80)).toBe(true)
    expect(isNearReset("weekly_model", resets - 3 * HOUR, resets, 80)).toBe(false)
    // リセットより後に達する・予測できない・すでに100%のときは対象外
    expect(isNearReset("five_hour", resets + MIN, resets, 80)).toBe(false)
    expect(isNearReset("five_hour", resets, resets, 80)).toBe(false)
    expect(isNearReset("five_hour", null, resets, 80)).toBe(false)
    expect(isNearReset("five_hour", resets - MIN, null, 80)).toBe(false)
    expect(isNearReset("five_hour", resets - MIN, resets, 100)).toBe(false)
  })

  it("リセットの直前に100%へ達する予測は beforeReset かつ nearReset。リセットまで余裕があれば beforeReset だけ", () => {
    // 1%あたり$1。窓の始まりの直後に$40(記録の時点で40%)、そのあと1時間は毎分$0.86 → いまは約91%で、約11分後に100%
    const scenario = (resetsAt: number) => {
      const rows: UsageRow[] = [row(resetsAt - 5 * HOUR + MIN, 40)]
      for (let m = 60; m >= 1; m--) rows.push(row(NOW - m * MIN, 0.86))
      const snapshots = [snap(NOW - 61 * MIN, [win("five_hour", 40, resetsAt)])]
      return only(buildUsage({ now: NOW, snapshots, rows, prices }).windows)
    }
    const near = scenario(NOW + 20 * MIN)
    expect(near.pace?.beforeReset).toBe(true)
    expect(((near.pace?.etaAt ?? 0) - NOW) / MIN).toBeLessThan(20)
    expect(near.pace?.nearReset).toBe(true)

    const far = scenario(NOW + 3 * HOUR)
    expect(far.pace?.beforeReset).toBe(true)
    expect(far.pace?.nearReset).toBe(false)
  })

  it("窓が始まって5分に満たないときは、ペースを出さない", () => {
    const resetsAt = NOW + 5 * HOUR - 2 * MIN // 始まりは NOW-2分
    const rows = [row(NOW - 2 * MIN, 1)]
    const snapshots = [snap(NOW - MIN, [win("five_hour", 1, resetsAt)])]
    expect(only(buildUsage({ now: NOW, snapshots, rows, prices }).windows).pace).toBeNull()
  })

  it("週は、直近24時間の平均でペースを出す", () => {
    const resetsAt = NOW + 4 * DAY // 始まりは3日前
    const rows: UsageRow[] = []
    // 直近24時間に毎時 $2(1%あたり$2 → 1%/時)。それより前は多く使っていても、ペースには効かない
    for (let h = 24; h >= 1; h--) rows.push(row(NOW - h * HOUR + 1, 2))
    rows.unshift(row(NOW - 2 * DAY, 100))
    const snapshots = [snap(NOW - 25 * HOUR, [win("weekly_all", 50, resetsAt)])]
    const w = only(buildUsage({ now: NOW, snapshots, rows, prices }).windows)
    expect(w.pace?.basis).toBe("mean24h")
    expect(w.pace?.mean60PerHour).toBeNull()
    expect(w.pace?.ratePerHour).toBeCloseTo(1, 0)
  })
})

describe("buildUsage: 上限ガード", () => {
  const resets = NOW + 2 * HOUR
  const rows = [row(NOW - 2 * HOUR, 1)]

  it("最新の公式値が80%以上なら注意、90%以上なら強い注意。推定ではなく公式値で決める", () => {
    const warn = buildUsage({ now: NOW, snapshots: [snap(NOW - HOUR, [win("five_hour", 82, resets)])], rows, prices })
    expect(warn.guard).toEqual({ level: "warn", windowLabel: "5時間", percent: 82 })
    const high = buildUsage({ now: NOW, snapshots: [snap(NOW - HOUR, [win("five_hour", 12, resets), win("weekly_all", 91, resets + 5 * DAY)])], rows, prices })
    expect(high.guard).toEqual({ level: "high", windowLabel: "週（全モデル）", percent: 91 })
    const none = buildUsage({ now: NOW, snapshots: [snap(NOW - HOUR, [win("five_hour", 79, resets)])], rows, prices })
    expect(none.guard).toEqual({ level: "none", windowLabel: null, percent: null })
  })

  it("枠が切り替わって公式値が無い窓は、前の枠の高い値でもガードに使わない", () => {
    const out = buildUsage({ now: NOW, snapshots: [snap(NOW - 6 * HOUR, [win("five_hour", 95, NOW - HOUR)])], rows, prices })
    expect(out.guard.level).toBe("none")
  })
})

describe("buildUsage: 精度の記録", () => {
  it("過去の公式値のたびに、その直前の推定との差を再現して、中央値と90パーセンタイルを出す", () => {
    const resets = NOW + 3 * HOUR // 始まりは NOW-2h
    const rows: UsageRow[] = []
    for (let m = 120; m >= 1; m--) rows.push(row(NOW - m * MIN, 0.1)) // 毎分$0.1(1%あたり$1)
    // 1%あたり$1 と整合する記録(5分ごと、整数に丸めた値)
    const snapshots: UsageSnapshot[] = []
    for (let m = 100; m >= 10; m -= 15) {
      const cost = (120 - m) * 0.1
      snapshots.push(snap(NOW - m * MIN, [win("five_hour", Math.round(cost), resets)]))
    }
    const out = buildUsage({ now: NOW, snapshots, rows, prices })
    expect(out.accuracy.samples).toBeGreaterThanOrEqual(3)
    expect(out.accuracy.medianAbsError).not.toBeNull()
    expect(out.accuracy.medianAbsError as number).toBeLessThan(1)
    expect(out.accuracy.p90AbsError as number).toBeLessThan(1.5)
  })

  it("同じ枠の公式値が2点未満なら、精度は出せない", () => {
    const out = buildUsage({
      now: NOW,
      snapshots: [snap(NOW - HOUR, [win("five_hour", 10, NOW + 2 * HOUR)])],
      rows: [row(NOW - 2 * HOUR, 10)],
      prices,
    })
    expect(out.accuracy).toEqual({ samples: 0, medianAbsError: null, p90AbsError: null })
  })
})

describe("buildUsage: 価格表にないモデル", () => {
  it("系統も分からないモデルは、opusの価格で仮に計算し、unregisteredModels に出す", () => {
    const out = buildUsage({
      now: NOW,
      snapshots: [snap(NOW - HOUR, [win("five_hour", 5, NOW + 2 * HOUR)])],
      rows: [row(NOW - 2 * HOUR, 1, { model: "mystery-model-x" })],
      prices,
    })
    expect(out.unregisteredModels).toEqual(["mystery-model-x"])
    // 表にないIDでも、系統が分かるもの(claude-opus-4-8)は未登録として扱わない
    const known = buildUsage({
      now: NOW,
      snapshots: [snap(NOW - HOUR, [win("five_hour", 5, NOW + 2 * HOUR)])],
      rows: [row(NOW - 2 * HOUR, 1, { model: "claude-opus-4-8" })],
      prices,
    })
    expect(known.unregisteredModels).toEqual([])
  })
})

describe("buildContributions", () => {
  const identities = new Map([
    ["session-a", { desktopId: "local_synthetic_a", title: "合成セッションA", groupId: "g1", groupName: "合成グループ1" }],
    ["session-b", { desktopId: "local_synthetic_b", title: "合成セッションB", groupId: "g1", groupName: "合成グループ1" }],
  ])
  const identityOf = (key: string) => identities.get(key) ?? null

  it("期間内の使用量を、セッション別に金額換算で集計し、多い順に並べる。Desktopに無いセッションは名前を付けず、グループなし", () => {
    const rows = [
      row(NOW - HOUR, 5, { sessionKey: "session-a" }),
      row(NOW - HOUR, 1, { sessionKey: "session-a" }),
      row(NOW - HOUR, 9, { sessionKey: "session-b" }),
      row(NOW - HOUR, 2, { sessionKey: "session-cli" }),
      row(NOW - 10 * HOUR, 50, { sessionKey: "session-a" }), // 期間より前
    ]
    const set = buildContributions(rows, NOW - 5 * HOUR, NOW, prices, identityOf)
    expect(set.since).toBe(NOW - 5 * HOUR)
    expect(set.items.map((i) => i.sessionKey)).toEqual(["session-b", "session-a", "session-cli"])
    expect(set.items[1].costUsd).toBeCloseTo(6, 6)
    expect(set.items[1]).toMatchObject({ desktopId: "local_synthetic_a", groupId: "g1", groupName: "合成グループ1" })
    expect(set.items[2]).toMatchObject({ desktopId: null, groupId: null, groupName: null })
    expect(set.items[2].title).not.toContain("session-cli")
    expect(set.items[1].tokens.output).toBeGreaterThan(0)
  })

  it("セッションが多いときは、上位40件だけを個別に出し、残りを1件にまとめる", () => {
    const rows = Array.from({ length: 45 }, (_, i) => row(NOW - HOUR, 45 - i, { sessionKey: `session-${i}` }))
    const set = buildContributions(rows, NOW - 5 * HOUR, NOW, prices, () => null)
    expect(set.items).toHaveLength(41)
    const other = set.items[40]
    expect(other.title).toBe("ほか5件")
    expect(other.costUsd).toBeCloseTo(5 + 4 + 3 + 2 + 1, 6)
  })
})
