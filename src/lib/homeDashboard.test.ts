import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { afterEach, describe, expect, it } from "vitest"
import { makeSessionSummary } from "./desktopFixtures"
import { DesktopSessionService } from "./desktopSessionService"
import type { DesktopSessionMessaging } from "./desktopSessionTypes"
import { FlowService } from "./flowService"
import {
  USAGE_KIND_LABEL,
  countDecisions,
  countSendLimitStopped,
  pickHomeWindows,
  countOutsideSessions,
  usageValueKind,
} from "./homeDashboard"
import { collectDecisions } from "./housekeeping"
import { usageLevel } from "./usageFormat"
import type { UsageWindowView } from "./usageTypes"

interface SampleModule {
  makeOrgChartSample: (outDir: string, options?: { now?: number }) => {
    dataDir: string
    projectsRoot: string
    write: () => Promise<void>
    groups: { a: string; b: string }
    ids: Record<string, string>
    expected: { housekeeping: { decisions: Array<[string, string[]]> }; needsAction: { decisionCount: number } }
  }
}

const cleanup: string[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

const messaging = (o: Partial<DesktopSessionMessaging> = {}): DesktopSessionMessaging => ({
  sent: 0,
  limit: 10,
  stopped: false,
  undelivered: 0,
  exact: true,
  ...o,
})

function windowView(o: Partial<UsageWindowView>): UsageWindowView {
  return {
    id: o.key ?? "five_hour",
    key: "five_hour",
    label: "5時間",
    modelName: null,
    windowStart: null,
    resetsAt: null,
    official: null,
    previousOfficial: null,
    estimate: { kind: "none", reason: "no-official" },
    displayPercent: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    costUsd: 0,
    calibration: null,
    pace: null,
    ...o,
  } as UsageWindowView
}

describe("ホームの件数（⑧）", () => {
  it("判断待ちは、整理ページと同じ関数で数える（送信上限で停止を含む。アーカイブ済みは除く）", () => {
    const sessions = [
      makeSessionSummary("a", { status: "blocked" }),
      makeSessionSummary("b", { messaging: messaging({ sent: 10, stopped: true }) }),
      makeSessionSummary("c", { status: "error" }),
      makeSessionSummary("d", { messaging: messaging({ sent: 2, undelivered: 1 }) }),
      makeSessionSummary("e", { status: "blocked", isArchived: true }),
      makeSessionSummary("f"),
    ]
    expect(countDecisions(sessions)).toBe(collectDecisions(sessions).length)
    expect(countDecisions(sessions)).toBe(4)
  })

  it("送信上限で停止は、止まっているセッションの数（アーカイブ済みは除く）", () => {
    const sessions = [
      makeSessionSummary("a", { messaging: messaging({ sent: 10, stopped: true }) }),
      makeSessionSummary("b", { messaging: messaging({ sent: 10, stopped: true }), isArchived: true }),
      makeSessionSummary("c", { messaging: messaging({ sent: 9 }) }),
      makeSessionSummary("d"),
    ]
    expect(countSendLimitStopped(sessions)).toBe(1)
    expect(countSendLimitStopped([])).toBe(0)
  })

  it("利用上限の値の種類は、ゲージと同じ決め方（推定 → 公式値 → 公式値なし）", () => {
    const estimate = windowView({ estimate: { kind: "estimate", percent: 23, low: 22, high: 23 }, displayPercent: 23 })
    const official = windowView({ displayPercent: 22, official: { percentUsed: 22, recordedAt: 1, resetsAt: 2 } })
    const none = windowView({})
    expect([estimate, official, none].map((w) => USAGE_KIND_LABEL[usageValueKind(w)])).toEqual(["推定", "公式値", "公式値なし"])
  })

  it("色の境目は 80・90・95%（利用上限のゲージと同じ関数）", () => {
    expect([79, 80, 89, 90, 94, 95, null].map((p) => usageLevel(p))).toEqual(["ok", "warning", "warning", "serious", "serious", "critical", "ok"])
  })

  it("ホームに出す窓は、5時間と週（全モデル）。モデル別の週は使わない", () => {
    const five = windowView({ key: "five_hour" })
    const weekly = windowView({ key: "weekly_all", label: "週（全モデル）" })
    const model = windowView({ key: "weekly_model", modelName: "Fable", label: "週（Fable）" })
    expect(pickHomeWindows([model, weekly, five])).toEqual({ fiveHour: five, weekly })
    expect(pickHomeWindows([])).toEqual({ fiveHour: null, weekly: null })
  })
})

describe("組織図に出ていないセッション（⑧）", () => {
  it("カードに出ているもの・アーカイブ済み・サイドチャットを除いて数える", () => {
    const sessions = [
      makeSessionSummary("shown", { status: "blocked" }),
      makeSessionSummary("old-idle", { lastActivityAt: 1_000 }),
      makeSessionSummary("new-idle", { lastActivityAt: 3_000 }),
      makeSessionSummary("running", { status: "running", lastActivityAt: 500 }),
      makeSessionSummary("decision", { status: "error", lastActivityAt: 100 }),
      makeSessionSummary("archived", { isArchived: true, lastActivityAt: 9_000 }),
      makeSessionSummary("side", { isSideChat: true, spawnedFromId: "shown", lastActivityAt: 9_000 }),
      makeSessionSummary("unknown-time"),
    ]
    expect(countOutsideSessions(sessions, new Set(["shown"]))).toBe(5)
  })

  it("合成データ: 判断待ちは整理ページと同じ11件（待機は数えない）、送信上限で停止は1件。試験グループの組織図に出ていないのは16件", async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(path.join(process.cwd(), "scripts", "make-org-chart-sample.mjs")).href)) as SampleModule
    const out = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-home-test-"))
    cleanup.push(out)
    const now = Date.now()
    const sample = mod.makeOrgChartSample(path.join(out, "sample"), { now })
    await sample.write()
    const sessions = new DesktopSessionService({ dataDir: sample.dataDir, projectsRoot: sample.projectsRoot, now: () => now })
    const list = await sessions.list()

    expect(countDecisions(list.sessions)).toBe(sample.expected.housekeeping.decisions.length)
    expect(countDecisions(list.sessions)).toBe(11)
    expect(countDecisions(list.sessions)).toBe(sample.expected.needsAction.decisionCount)
    expect(countSendLimitStopped(list.sessions)).toBe(1)

    const flow = await new FlowService(sessions, { now: () => now }).build(sample.groups.a)
    const shown = new Set((flow?.members ?? []).map((m) => m.id))
    expect(countOutsideSessions(list.sessions, shown)).toBe(16)
  })
})
