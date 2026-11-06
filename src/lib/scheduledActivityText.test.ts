process.env.TZ = "Asia/Tokyo"

import { promises as fs } from "fs"
import path from "path"
import { describe, expect, it } from "vitest"
import { SCHEDULED_TASK_LABEL, compareRuns } from "./scheduledActivity"
import {
  agoText,
  conclusionLine2,
  countText,
  dayText,
  periodText,
  runSubagentText,
  signed,
  subagentText,
  tokensText,
  typesLine,
} from "./scheduledActivityText"
import type { ScheduledRun } from "./scheduledActivityTypes"
import { formatTokens } from "./usageFormat"

const jst = (s: string) => Date.parse(`${s.replace(" ", "T")}:00+09:00`)
let seq = 0
function run(at: string, o: Partial<ScheduledRun> = {}): ScheduledRun {
  return {
    desktopId: `local_${++seq}`,
    taskId: "watch",
    startedAt: jst(at),
    mark: { symbol: "●", text: "完了", tone: "green", estimated: false, decision: false },
    stopReason: null,
    archived: true,
    running: false,
    hasUsage: true,
    cost: 1,
    mainCost: 1,
    mainFamilies: ["Opus"],
    subagentCount: 0,
    subagentFamilies: [],
    subagentTypes: {},
    tokens: [],
    ...o,
  }
}

const now = jst("2026-11-10 12:00")
const horizon = now - 30 * 86_400_000
const before = ["10-31", "11-02", "11-04", "11-06"].map((d) => run(`2026-${d} 07:09`, { subagentCount: 1, subagentFamilies: ["Haiku"], subagentTypes: { "web-fetch": 1 } }))
const after = ["11-07", "11-08", "11-09"].map((d) =>
  run(`2026-${d} 07:09`, { cost: 0.78, mainCost: 0.64, subagentCount: 2, subagentFamilies: ["Sonnet"], subagentTypes: { "general-purpose": 2 } })
)

describe("[AG-3] 結論の2行目と比べの文", () => {
  it("差が出るときは「後の7日は1回あたりの重さ 78・本体 Opus 64(前の7日を100)」と途中の日", () => {
    const c = compareRuns([...before, ...after, run("2026-11-10 07:09", { running: true })], "2026-11-07", now, horizon)
    expect(conclusionLine2("watch", c, "Opus", 30)).toBe("watch：後の7日は1回あたりの重さ 78・本体 Opus 64（前の7日を100）・3回と4回の平均（推定）・途中（4日目・あと3日）")
    expect(countText(c.after)).toBe("4（作業中1 を除く）")
    expect(periodText(c)).toBe("前の7日 10/31〜11/06・後の7日 11/07〜11/13")
    expect(subagentText(c.before)).toBe("1.0本（Haiku）")
    expect(subagentText(c.after)).toBe("2.0本（Sonnet）")
    expect(typesLine(c)).toBe("種類（1回あたり）：前 web-fetch 1.0 → 後 general-purpose 2.0")
    expect(signed(c.diff!.total)).toBe("−22")
    expect(signed(c.diff!.main!)).toBe("−36")
  })

  it("差が出ないときは理由(回数が少ない・記録の外)", () => {
    const few = compareRuns([...before, after[0]], "2026-11-07", now, horizon)
    expect(conclusionLine2("watch", few, "Opus", 30)).toBe("watch：回数が少ないため比べない（前4回・後1回）・途中（4日目・あと3日）")
    const out = compareRuns([...before, ...after], "2026-11-07", jst("2026-11-14 12:00"), jst("2026-11-01 00:00"))
    expect(conclusionLine2("watch", out, "Opus", 15)).toBe("watch：前の7日のうち1回は記録の外（15日より前）のため比べない")
  })
})

describe("[A15] 言葉と書き方", () => {
  it("トークンは［利用上限］と同じ関数で書き、サブエージェントの分には「サブ」を付ける", () => {
    const tokens = [
      { family: "Opus" as const, subagent: false, tokens: 2_400_000 },
      { family: "Haiku" as const, subagent: true, tokens: 680_000 },
    ]
    expect(tokensText(tokens)).toBe(`Opus ${formatTokens(2_400_000)}・サブ Haiku ${formatTokens(680_000)}`)
    expect(tokensText(tokens)).toBe("Opus 2.4M・サブ Haiku 680K")
    expect(runSubagentText(run("2026-11-05 07:09", { subagentCount: 2, subagentFamilies: ["Haiku"] }))).toBe("2（Haiku）")
    expect(runSubagentText(run("2026-11-05 07:09"))).toBe("0")
  })

  it("日付・何時間前・符号", () => {
    expect(dayText("2026-11-07")).toBe("11/07（土）")
    expect(agoText(now - 3 * 3600_000, now)).toBe("3時間前")
    expect(agoText(now - 20 * 60_000, now)).toBe("20分前")
    expect(agoText(now - 50 * 3600_000, now)).toBe("2日前")
    expect(signed(0.2)).toBe("0")
    expect(signed(4.6)).toBe("+5")
  })

  it("画面の文に「走り」「成功」「失敗」「ラン」「アドバイザー」「定期実行」が無く、一覧の印とタブで呼び方が同じ", async () => {
    const root = path.resolve(__dirname, "..")
    const files = [
      "components/resources/ScheduledView.tsx",
      "lib/scheduledActivityText.ts",
      "lib/scheduledActivity.ts",
      "components/desktopSessions/SessionRow.tsx",
      "components/desktopSessions/format.ts",
      "app/desktop-sessions/usage/page.tsx",
    ]
    for (const f of files) {
      const text = await fs.readFile(path.join(root, f), "utf-8")
      for (const word of ["走り", "成功", "失敗", "ラン", "アドバイザー", "定期実行"]) expect(text.includes(word), `${f} に「${word}」`).toBe(false)
    }
    const page = await fs.readFile(path.join(root, "app/desktop-sessions/usage/page.tsx"), "utf-8")
    const row = await fs.readFile(path.join(root, "components/desktopSessions/SessionRow.tsx"), "utf-8")
    expect(page).toContain("label: SCHEDULED_TASK_LABEL")
    expect(row).toContain("{SCHEDULED_TASK_LABEL}")
    expect(SCHEDULED_TASK_LABEL).toBe("予定タスク")
  })
})
