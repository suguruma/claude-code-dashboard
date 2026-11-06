// 日の境目は PC の時刻(日本時間)。どの PC で流しても同じになるよう、時刻帯を固定する
process.env.TZ = "Asia/Tokyo"

import { describe, expect, it } from "vitest"
import {
  addDays,
  buildTaskList,
  chooseDefault,
  compareRuns,
  dailyRows,
  dayKey,
  familyLabel,
  indexOf,
  initialBoundary,
  limitPercents,
  summarizeTasks,
  usualMainFamily,
} from "./scheduledActivity"
import type { FamilyLabel, ScheduledRun } from "./scheduledActivityTypes"
import type { StatusMark } from "./statusMark"

const DONE: StatusMark = { symbol: "●", text: "完了", tone: "green", estimated: false, decision: false }
const ERROR: StatusMark = { symbol: "×", text: "エラー", tone: "red", estimated: false, decision: false }
const RUNNING: StatusMark = { symbol: "◌", text: "作業中", tone: "blue", estimated: true, decision: false }

/** 日本時間の「YYYY-MM-DD HH:mm」→ ms */
const jst = (s: string) => Date.parse(`${s.replace(" ", "T")}:00+09:00`)

let seq = 0
function run(taskId: string, at: string, o: Partial<ScheduledRun> & { sub?: FamilyLabel[] } = {}): ScheduledRun {
  const { sub, ...rest } = o
  return {
    desktopId: `local_${++seq}`,
    taskId,
    startedAt: jst(at),
    mark: DONE,
    stopReason: null,
    archived: true,
    running: false,
    hasUsage: true,
    cost: 1,
    mainCost: 0.9,
    mainFamilies: ["Opus"],
    subagentCount: sub?.length ?? 0,
    subagentFamilies: sub ?? [],
    subagentTypes: {},
    tokens: [],
    ...rest,
  }
}

describe("[AG-2][AG-3] 日の境目は日本時間の0時", () => {
  it("日本時間 07:09 の回(UTC では前の日)は、その日に入る", () => {
    const at = jst("2026-11-07 07:09")
    expect(new Date(at).toISOString().slice(0, 10)).toBe("2026-11-06")
    expect(dayKey(at)).toBe("2026-11-07")
    expect(addDays("2026-11-07", -7)).toBe("2026-10-31")
  })

  it("系統は版の違いをまとめる(同じ系統で版だけ違う物は同じ)", () => {
    expect(familyLabel("claude-opus-5-0")).toBe("Opus")
    expect(familyLabel("claude-opus-5-5")).toBe("Opus")
    expect(familyLabel("claude-sonnet-5-5")).toBe("Sonnet")
    expect(familyLabel("some-other-model")).toBe("その他")
  })
})

describe("[AG-3][A3][A14] 7日の平均どうしの比べ", () => {
  const now = jst("2026-11-10 12:00")
  const horizonStart = now - 30 * 24 * 3600_000
  const runs = [
    // 前の7日(10/31〜11/06)：4回。Haiku のサブエージェント
    run("w", "2026-10-31 07:09", { cost: 1.0, mainCost: 0.9, sub: ["Haiku"], subagentTypes: { "web-fetch": 1 } }),
    run("w", "2026-11-02 07:09", { cost: 1.2, mainCost: 1.1, sub: ["Haiku"], subagentTypes: { "web-fetch": 1 } }),
    run("w", "2026-11-04 07:09", { cost: 0.8, mainCost: 0.8 }),
    run("w", "2026-11-06 07:09", { cost: 1.0, mainCost: 0.8, sub: ["Haiku", "Haiku"], subagentTypes: { "web-fetch": 2 } }),
    // 後の7日(11/07〜)：3回が読めて終わった回＋記録なし1＋作業中1
    run("w", "2026-11-07 07:09", { cost: 0.8, mainCost: 0.5, sub: ["Sonnet", "Sonnet"], subagentTypes: { "general-purpose": 2 } }),
    run("w", "2026-11-08 07:09", { cost: 0.7, mainCost: 0.4, sub: ["Sonnet", "Sonnet"], subagentTypes: { "general-purpose": 2 } }),
    run("w", "2026-11-09 07:09", { cost: 0.9, mainCost: 0.6, sub: ["Sonnet", "Sonnet"], subagentTypes: { "general-purpose": 1, 種類不明: 1 } }),
    run("w", "2026-11-09 19:00", { hasUsage: false, cost: 0, mainCost: 0 }),
    run("w", "2026-11-10 07:09", { running: true, mark: RUNNING, cost: 5, mainCost: 5 }),
  ]

  it("前を100とした合計と本体の重さ・幅・回数・サブエージェントが出て、差は重さだけ", () => {
    const c = compareRuns(runs, "2026-11-07", now, horizonStart)
    expect(c.before).toMatchObject({ from: "2026-10-31", to: "2026-11-06", total: 4, valid: 4, noRecord: 0, running: 0 })
    expect(c.after).toMatchObject({ from: "2026-11-07", to: "2026-11-13", total: 5, valid: 3, noRecord: 1, running: 1 })
    expect(c.index.before?.total).toBeCloseTo(100)
    expect(c.index.before?.main).toBeCloseTo(100)
    expect(c.index.before?.min).toBeCloseTo(80)
    expect(c.index.before?.max).toBeCloseTo(120)
    // 後の平均 0.8(作業中の 5 と記録なしは入らない)・本体 0.5 / 0.9
    expect(c.index.after?.total).toBeCloseTo(80)
    expect(c.index.after?.main).toBeCloseTo((0.5 / 0.9) * 100)
    expect(c.diff?.total).toBeCloseTo(-20)
    expect(c.diff?.main).toBeCloseTo((0.5 / 0.9) * 100 - 100)
    expect(Object.keys(c.diff ?? {}).sort()).toEqual(["main", "total"])
    expect(c.before.avgSubagents).toBeCloseTo(1)
    expect(c.after.avgSubagents).toBeCloseTo(2)
    expect(c.before.subagentFamilies).toEqual(["Haiku"])
    expect(c.after.subagentFamilies).toEqual(["Sonnet"])
    expect(c.before.typesPerRun).toEqual([{ type: "web-fetch", perRun: 1 }])
    expect(c.after.typesPerRun[0]).toEqual({ type: "general-purpose", perRun: 5 / 3 })
    expect(c.after.typesPerRun[1]).toEqual({ type: "種類不明", perRun: 1 / 3 })
    expect(indexOf(1.1, c)).toBeCloseTo(110)
  })

  it("境目を変えると、前と後の回数と重さが替わる", () => {
    const a = compareRuns(runs, "2026-11-07", now, horizonStart)
    const b = compareRuns(runs, "2026-11-05", now, horizonStart)
    // 前 10/29〜11/04 は 10/31・11/02・11/04、後 11/05〜11/11 は 11/06〜11/10 の6回
    expect(b.before.total).toBe(3)
    expect(b.after.total).toBe(6)
    // 後の平均は 11/06(1.0)が入って 0.85 になる
    expect(a.after.avgCost).toBeCloseTo(0.8)
    expect(b.after.avgCost).toBeCloseTo(0.85)
  })

  it("どちらかが3回未満なら差を出さない", () => {
    const c = compareRuns(runs.slice(2), "2026-11-07", now, horizonStart)
    expect(c.before.valid).toBe(2)
    expect(c.diff).toBeNull()
    expect(c.blocked).toBe("few")
  })

  it("前の7日の回が読む期間より前なら「記録の外」で差を出さない", () => {
    const c = compareRuns(runs, "2026-11-07", now, jst("2026-11-01 00:00"))
    expect(c.before.outOfRecord).toBe(1)
    expect(c.diff).toBeNull()
    expect(c.blocked).toBe("out-of-record")
  })

  it("後の7日が途中なら何日目とあと何日(境目の3日後に開くと4日目・あと3日)", () => {
    expect(compareRuns(runs, "2026-11-07", now, horizonStart).progress).toEqual({ day: 4, left: 3 })
    expect(compareRuns(runs, "2026-11-07", jst("2026-11-07 08:00"), horizonStart).progress).toEqual({ day: 1, left: 6 })
    expect(compareRuns(runs, "2026-11-07", jst("2026-11-14 08:00"), horizonStart).progress).toBeNull()
  })

  it("[A12] 上限の約％は係数が決まるときだけ、前と後に同じ係数で出す", () => {
    const c = compareRuns(runs, "2026-11-07", now, horizonStart)
    expect(limitPercents(c, null)).toBeNull()
    expect(limitPercents(c, { costPerPercentLow: 0.1, costPerPercentHigh: null })).toBeNull()
    const p = limitPercents(c, { costPerPercentLow: 0.1, costPerPercentHigh: 0.3 })
    expect(p?.before).toBeCloseTo(5)
    expect(p?.after).toBeCloseTo(4)
  })
})

describe("[AG-2][A2] 日ごとの表", () => {
  it("1日2回の日は2行、動かなかった日は空の1行。新しい順で、今日まで", () => {
    const runs = [run("w", "2026-11-08 07:09"), run("w", "2026-11-08 19:00"), run("w", "2026-11-05 07:09")]
    const rows = dailyRows(runs, "2026-11-07", jst("2026-11-10 12:00"))
    expect(rows.map((r) => r.day)[0]).toBe("2026-11-10")
    expect(rows.map((r) => r.day).at(-1)).toBe("2026-10-31")
    expect(rows).toHaveLength(11)
    const nov8 = rows.find((r) => r.day === "2026-11-08")
    expect(nov8?.runs.map((r) => r.startedAt)).toEqual([jst("2026-11-08 19:00"), jst("2026-11-08 07:09")])
    expect(rows.find((r) => r.day === "2026-11-09")?.runs).toEqual([])
  })

  it("いつもの本体の系統(替わった回だけ印を付けるため)", () => {
    expect(usualMainFamily([run("w", "2026-11-01 07:00"), run("w", "2026-11-02 07:00"), run("w", "2026-11-03 07:00", { mainFamilies: ["Sonnet"] })])).toBe("Opus")
  })
})

describe("[AG-1] 予定タスクの一覧と結論の1行目", () => {
  const now = jst("2026-11-10 12:00")
  const runs = [
    run("a", "2026-11-10 07:09"),
    run("a", "2026-11-09 07:09"),
    run("b", "2026-11-10 03:00", { mark: ERROR }),
    run("c", "2026-11-07 08:00", { mainFamilies: ["Sonnet"] }),
    run("old", "2026-10-20 08:00"),
  ]

  it("最後の回の新しい順。直近14日に回が無い物と定義だけの物は下にまとめる", () => {
    const list = buildTaskList(runs, ["a", "b", "c", "old", "unused"], now)
    expect(list.rows.map((r) => r.taskId)).toEqual(["a", "b", "c"])
    expect(list.rows[0]).toMatchObject({ recentRuns: 2, mainFamily: "Opus" })
    expect(list.rows[2].mainFamily).toBe("Sonnet")
    expect(list.idle).toEqual(["old", "unused"])
  })

  it("状態ごとの数・止まった物の名前・24時間より前の数", () => {
    const s = summarizeTasks(buildTaskList(runs, [], now).rows, now)
    expect(s.count).toBe(3)
    expect(s.marks.map((m) => [m.mark.text, m.count, m.names])).toEqual([
      ["完了", 2, []],
      ["エラー", 1, ["b"]],
    ])
    expect(s.stale).toBe(1)
  })
})

describe("[A13] 既定で選ぶ予定タスクと初めの境目の日", () => {
  function dataset(): ScheduledRun[] {
    const runs: ScheduledRun[] = []
    // watch：10/24〜10/30 は Opus だけ、10/31〜11/06 は4回中3回 Haiku、11/07 から Opus＋Sonnet を使い続ける
    for (const d of ["10-24", "10-26", "10-28", "10-30"]) runs.push(run("watch", `2026-${d} 07:09`))
    runs.push(run("watch", "2026-10-31 07:09", { sub: ["Haiku"] }))
    runs.push(run("watch", "2026-11-02 07:09", { sub: ["Haiku"] }))
    runs.push(run("watch", "2026-11-04 07:09"))
    runs.push(run("watch", "2026-11-06 07:09", { sub: ["Haiku", "Haiku"] }))
    for (let i = 7; i <= 14; i++) runs.push(run("watch", `2026-11-${String(i).padStart(2, "0")} 07:09`, { sub: ["Sonnet", "Sonnet"] }))
    // inbox：11/02 から Haiku を使い続ける(境目より前に使い始めた)
    for (let i = 20; i <= 31; i++) runs.push(run("inbox", `2026-10-${i} 06:00`, i >= 33 ? { sub: ["Haiku"] } : {}))
    for (let i = 1; i <= 14; i++) runs.push(run("inbox", `2026-11-${String(i).padStart(2, "0")} 06:00`, i >= 2 ? { sub: ["Haiku"] } : {}))
    // (1) 境目の後に初めて動いた予定タスク(初回は数えない)。本体は Fable
    for (let i = 8; i <= 14; i++) runs.push(run("late", `2026-11-${String(i).padStart(2, "0")} 10:00`, { mainFamilies: ["Fable"] }))
    // (2) 同じ系統で版だけ替わった(系統の名前は同じ Opus)
    for (let i = 1; i <= 14; i++) runs.push(run("version", `2026-11-${String(i).padStart(2, "0")} 05:30`, { mainFamilies: ["Opus"] }))
    // (3) 読み取りを15日に戻し、時々だけ Haiku を使う(読める最初の回には Haiku が無い)
    for (let i = 1; i <= 14; i++) runs.push(run("sometimes", `2026-11-${String(i).padStart(2, "0")} 09:15`, i % 4 === 0 ? { sub: ["Haiku"] } : {}))
    return runs
  }

  it("境目の日・3日後・7日後(11/14 に当たる日)のどれでも watch が選ばれ、境目はその回の日", () => {
    for (const at of ["2026-11-07 08:00", "2026-11-10 12:00", "2026-11-14 12:00"]) {
      const now = jst(at)
      const runs = dataset().filter((r) => r.startedAt <= now)
      expect(chooseDefault(runs, now)).toEqual({ taskId: "watch", reason: "new-family", boundaryDay: "2026-11-07" })
    }
  })

  it("3日後に開くと、初めの境目の日で「途中(4日目・あと3日)」になる", () => {
    const now = jst("2026-11-10 12:00")
    const runs = dataset().filter((r) => r.startedAt <= now)
    const sel = chooseDefault(runs, now)
    const boundary = initialBoundary("watch", null, sel, now)
    expect(boundary).toBe("2026-11-07")
    const c = compareRuns(runs.filter((r) => r.taskId === "watch"), boundary, now, now - 30 * 86_400_000)
    expect(c.progress).toEqual({ day: 4, left: 3 })
  })

  it("watch が新しい系統を使わなかったら、ほかの物(使い続けた inbox)になる", () => {
    const now = jst("2026-11-10 12:00")
    const runs = dataset()
      .filter((r) => r.startedAt <= now)
      .map((r) => (r.taskId === "watch" && r.subagentFamilies.includes("Sonnet") ? { ...r, subagentFamilies: [] } : r))
    expect(chooseDefault(runs, now)).toMatchObject({ taskId: "inbox", boundaryDay: "2026-11-02" })
  })

  it("新しい系統の回が無ければ、直近14日の重さの合計が大きい物。境目は今日の7日前", () => {
    const now = jst("2026-11-10 12:00")
    const runs = [run("light", "2026-11-09 07:00", { cost: 1 }), run("heavy", "2026-11-09 08:00", { cost: 3 }), run("light", "2026-11-08 07:00", { cost: 1 })]
    const sel = chooseDefault(runs, now)
    expect(sel).toEqual({ taskId: "heavy", reason: "weight", boundaryDay: null })
    expect(initialBoundary("heavy", null, sel, now)).toBe("2026-11-03")
    expect(chooseDefault([], now)).toBeNull()
  })

  it("前に選んだ境目の日があればそれ。自分で選んだ物(既定と違う物)は今日の7日前", () => {
    const now = jst("2026-11-10 12:00")
    const sel = { taskId: "watch", reason: "new-family" as const, boundaryDay: "2026-11-07" }
    expect(initialBoundary("watch", "2026-11-05", sel, now)).toBe("2026-11-05")
    expect(initialBoundary("watch", "壊れた値", sel, now)).toBe("2026-11-07")
    expect(initialBoundary("inbox", null, sel, now)).toBe("2026-11-03")
  })
})
