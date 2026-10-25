import { describe, expect, it } from "vitest"
import { makeSessionSummary } from "./desktopFixtures"
import type { DesktopSessionMessaging, DesktopSessionSummary } from "./desktopSessionTypes"
import { collectDecisions } from "./housekeeping"
import {
  activeFilterCount,
  applyPhoneFilters,
  countRunning,
  decisionWaitLabel,
  parsePhoneFilters,
  parseSessionHash,
  phoneDecisionRows,
  phoneQuestion,
  phoneFiltersToSearch,
  sendLimitStopped,
  sessionHash,
  sortPhoneSessions,
  summarizeGroups,
} from "./phoneView"

const messaging = (o: Partial<DesktopSessionMessaging> = {}): DesktopSessionMessaging => ({
  sent: 0,
  limit: 10,
  stopped: false,
  undelivered: 0,
  exact: true,
  ...o,
})

const blocked = (id: string, kind: "permission" | "approval" | "decision", at: number, o: Partial<DesktopSessionSummary> = {}) =>
  makeSessionSummary(id, {
    status: "blocked",
    needsAction: true,
    needsActionInfo: { kind, source: "summary-words", estimated: true, buttons: [] },
    lastActivityAt: at,
    ...o,
  })

const groupA = { id: "group_a", name: "グループA" }
const groupB = { id: "group_b", name: "グループB" }

describe("スマホのホームの対応待ち", () => {
  it("整理ページと同じ関数・同じ並びで、上位3件と全体の件数を出す", () => {
    const sessions = [
      blocked("local_d1", "decision", 1000),
      blocked("local_p1", "permission", 3000),
      makeSessionSummary("local_s1", { messaging: messaging({ stopped: true }), lastActivityAt: 500 }),
      blocked("local_a1", "approval", 2000),
      makeSessionSummary("local_r1", { status: "running", lastActivityAt: 9000 }),
      blocked("local_x1", "decision", 100, { isArchived: true }),
    ]
    const rows = phoneDecisionRows(sessions)
    expect(rows.total).toBe(collectDecisions(sessions).length)
    expect(rows.total).toBe(4)
    expect(rows.items.map((d) => d.id)).toEqual(["local_p1", "local_a1", "local_d1"])
    expect(rows.items.map(decisionWaitLabel)).toEqual(["許可待ち", "承認待ち", "判断待ち"])
  })

  it("何を待っているかの言葉：送信上限・エラー・届かなかった送信は理由の名前", () => {
    const [stopped] = collectDecisions([makeSessionSummary("local_s", { messaging: messaging({ stopped: true }) })])
    expect(decisionWaitLabel(stopped)).toBe("送信上限で停止中")
    const [error] = collectDecisions([makeSessionSummary("local_e", { status: "error" })])
    expect(decisionWaitLabel(error)).toBe("エラー")
  })

  it("実行中と送信上限の数は、アーカイブ済みを数えない", () => {
    const sessions = [
      makeSessionSummary("local_1", { status: "running" }),
      makeSessionSummary("local_2", { status: "running", isArchived: true }),
      makeSessionSummary("local_3", { messaging: messaging({ stopped: true }) }),
      makeSessionSummary("local_4", { messaging: messaging({ stopped: true }), isArchived: true }),
    ]
    expect(countRunning(sessions)).toBe(1)
    expect(sendLimitStopped(sessions).map((s) => s.id)).toEqual(["local_3"])
  })
})

describe("スマホの一覧の並びと絞り込み", () => {
  const sessions = [
    makeSessionSummary("local_c1", { status: "completed", lastActivityAt: 9000, group: groupA }),
    makeSessionSummary("local_r1", { status: "running", lastActivityAt: 1000, group: groupB }),
    blocked("local_b1", "decision", 500, { group: groupA }),
    makeSessionSummary("local_r2", { status: "running", lastActivityAt: 2000 }),
    makeSessionSummary("local_w1", { status: "standby", lastActivityAt: null, group: groupB }),
    makeSessionSummary("local_old", { status: "running", isArchived: true }),
    makeSessionSummary("local_h1", {
      status: "completed",
      lastActivityAt: 8000,
      context: { tokens: 900_000, limit: 1_000_000, ratio: 0.9 },
      group: groupA,
    }),
  ]

  it("対応待ち → 実行中 → そのほか。それぞれ最後の動きが新しい順で、不明は最後。アーカイブ済みは出さない", () => {
    expect(sortPhoneSessions(sessions).map((s) => s.id)).toEqual(["local_b1", "local_r2", "local_r1", "local_c1", "local_h1", "local_w1"])
  })

  it("状態とグループで絞る", () => {
    const sorted = sortPhoneSessions(sessions)
    const ids = (status: Parameters<typeof applyPhoneFilters>[1]["status"], group = "all") =>
      applyPhoneFilters(sorted, { status, group }, 0.8).map((s) => s.id)
    expect(ids("attention")).toEqual(["local_b1"])
    expect(ids("running")).toEqual(["local_r2", "local_r1"])
    expect(ids("standby")).toEqual(["local_w1"])
    expect(ids("highContext")).toEqual(["local_h1"])
    expect(ids("all", "group_a")).toEqual(["local_b1", "local_c1", "local_h1"])
    expect(ids("all", "none")).toEqual(["local_r2"])
    expect(ids("running", "group_b")).toEqual(["local_r1"])
  })

  it("グループごとの短い一覧(組織図の代わり)は、グループの順で、件数・実行中・対応待ちを数え、空のグループは出さない", () => {
    const groups = [
      { id: "group_b", name: "グループB", order: 1, count: 2 },
      { id: "group_a", name: "グループA", order: 0, count: 3 },
      { id: "group_empty", name: "空", order: 2, count: 0 },
    ]
    expect(summarizeGroups(sessions, groups)).toEqual([
      { id: "group_a", name: "グループA", total: 3, running: 0, attention: 1 },
      { id: "group_b", name: "グループB", total: 2, running: 1, attention: 0 },
      { id: "none", name: "グループなし", total: 1, running: 1, attention: 0 },
    ])
  })
})

describe("スマホの URL の値", () => {
  const params = (s: string) => new URLSearchParams(s)

  it("絞り込みは URL の検索で持つ。知らない値は既定に戻す", () => {
    expect(parsePhoneFilters(params("status=running&group=group_a"))).toEqual({ status: "running", group: "group_a" })
    expect(parsePhoneFilters(params("status=bogus&group=<script>"))).toEqual({ status: "all", group: "all" })
    expect(phoneFiltersToSearch({ status: "all", group: "all" })).toBe("")
    expect(phoneFiltersToSearch({ status: "attention", group: "group_a" })).toBe("?status=attention&group=group_a")
    expect(activeFilterCount({ status: "attention", group: "all" })).toBe(1)
  })

  it("詳細のシートの印は、セッション ID の形だけを受け取る", () => {
    expect(parseSessionHash(sessionHash("local_abc-123"))).toBe("local_abc-123")
    expect(parseSessionHash(sessionHash("00000000-0000-4000-8000-000000000001"))).toBe("00000000-0000-4000-8000-000000000001")
    for (const bad of ["", "#", "#session=", "#session=../api/rules", "#session=%E0%A4%A", "#other=local_x", "#session=local_a/b"]) {
      expect(parseSessionHash(bad), bad).toBeNull()
    }
  })
})

describe("[ND-15] スマホの対応待ちの行の問いの文(⑬ の D5)", () => {
  it("問いがあれば出し、要約から取った問いは「要約：」を付ける。無ければ null", () => {
    const decision = (question: string | null, questionSource: "wrap-up" | "summary" | null) => ({
      question,
      questionSource,
      moreQuestions: 0,
      options: [],
      moreOptions: 0,
      recommended: null,
      errorText: null,
    })
    expect(phoneQuestion(makeSessionSummary("a", { decision: decision("どちらで進めますか", "wrap-up") }))).toBe("どちらで進めますか")
    expect(phoneQuestion(makeSessionSummary("b", { decision: decision("反映を承認してください", "summary") }))).toBe("要約：反映を承認してください")
    expect(phoneQuestion(makeSessionSummary("c", { decision: null }))).toBeNull()
    expect(phoneQuestion(undefined)).toBeNull()
  })
})
