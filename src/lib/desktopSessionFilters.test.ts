import { describe, expect, it } from "vitest"
import { DEFAULT_FILTERS, applyFilters, bucketByGroup, collectOptions, normalizeFilters, visibleGroups } from "./desktopSessionFilters"
import type { DesktopSessionSummary } from "./desktopSessionTypes"

function session(id: string, overrides: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    id,
    title: id,
    cwd: null,
    folderName: "app",
    model: "claude-sonnet-5-5",
    effort: null,
    permissionMode: null,
    isArchived: false,
    isRoutine: false,
    pinned: false,
    group: null,
    status: "completed",
    statusReason: "",
    needsAction: false,
    needsActionExcerpt: null,
    needsActionInfo: null,
    standbyInfo: null,
    decision: null,
    createdAt: null,
    lastActivityAt: null,
    completedTurns: null,
    transcript: "found",
    digest: "full",
    context: null,
    lastAssistantAt: null,
    phase: null,
    compactionCount: 0,
    latestInstruction: null,
    latestInputOrigin: null,
    queuedInputs: 0,
    messaging: null,
    spawnedFromId: null,
    isSideChat: false,
    ...overrides,
  }
}

const ids = (list: DesktopSessionSummary[]) => list.map((s) => s.id)

describe("applyFilters", () => {
  const sessions = [
    session("a", { status: "running", group: { id: "g1", name: "設計" }, model: "claude-opus-5-5", folderName: "web" }),
    session("b", { status: "blocked", context: { tokens: 900_000, limit: 1_000_000, ratio: 0.9 } }),
    session("c", { isArchived: true }),
    session("d", { status: "running", context: { tokens: 100, limit: 1_000_000, ratio: 0.1 } }),
  ]

  it("既定ではアーカイブ済みを除く", () => {
    expect(ids(applyFilters(sessions, DEFAULT_FILTERS, 0.8))).toEqual(["a", "b", "d"])
    expect(ids(applyFilters(sessions, { ...DEFAULT_FILTERS, includeArchived: true }, 0.8))).toEqual(["a", "b", "c", "d"])
  })

  it("状態・コンテキスト使用率で絞り込む", () => {
    expect(ids(applyFilters(sessions, { ...DEFAULT_FILTERS, status: "running" }, 0.8))).toEqual(["a", "d"])
    expect(ids(applyFilters(sessions, { ...DEFAULT_FILTERS, status: "highContext" }, 0.8))).toEqual(["b"])
  })

  it("グループ・モデル・作業フォルダで絞り込む", () => {
    expect(ids(applyFilters(sessions, { ...DEFAULT_FILTERS, group: "g1" }, 0.8))).toEqual(["a"])
    expect(ids(applyFilters(sessions, { ...DEFAULT_FILTERS, group: "none" }, 0.8))).toEqual(["b", "d"])
    expect(ids(applyFilters(sessions, { ...DEFAULT_FILTERS, model: "claude-opus-5-5" }, 0.8))).toEqual(["a"])
    expect(ids(applyFilters(sessions, { ...DEFAULT_FILTERS, folder: "web" }, 0.8))).toEqual(["a"])
  })
})

describe("bucketByGroup", () => {
  it("サイドバーの並び順で分け、グループなしを最後に置く。空のグループは出さない", () => {
    const groups = [
      { id: "g1", name: "設計", order: 1, count: 1 },
      { id: "g2", name: "空", order: 2, count: 0 },
      { id: "g3", name: "実装", order: 3, count: 1 },
    ]
    const list = [
      session("a", { group: { id: "g3", name: "実装" } }),
      session("b"),
      session("c", { group: { id: "g1", name: "設計" } }),
      session("d", { group: { id: "missing", name: "消えたグループ" } }),
    ]
    const buckets = bucketByGroup(list, groups)
    expect(buckets.map((b) => [b.name, ids(b.sessions)])).toEqual([
      ["設計", ["c"]],
      ["実装", ["a"]],
      ["グループなし", ["b", "d"]],
    ])
  })
})

describe("collectOptions", () => {
  it("件数の多い順に重複なく返す", () => {
    const list = [session("a", { model: "m1" }), session("b", { model: "m2" }), session("c", { model: "m2" }), session("d", { model: null })]
    expect(collectOptions(list, (s) => s.model)).toEqual(["m2", "m1"])
  })
})

describe("visibleGroups(件数0のグループを隠す)", () => {
  const groups = [
    { id: "g1", name: "設計", order: 1, count: 99 },
    { id: "g2", name: "アーカイブだけ", order: 2, count: 99 },
    { id: "g3", name: "空", order: 3, count: 99 },
  ]
  const list = [
    session("a", { group: { id: "g1", name: "設計" } }),
    session("b", { group: { id: "g1", name: "設計" } }),
    session("c", { group: { id: "g2", name: "アーカイブだけ" }, isArchived: true }),
  ]

  it("件数0のグループは出さず、件数はサーバーの値ではなく表示対象のセッションから数える", () => {
    expect(visibleGroups(groups, list, false, "all").map((g) => [g.name, g.count])).toEqual([["設計", 2]])
  })

  it("アーカイブ済みを含める設定のときは、その件数で判定する", () => {
    expect(visibleGroups(groups, list, true, "all").map((g) => [g.name, g.count])).toEqual([
      ["設計", 2],
      ["アーカイブだけ", 1],
    ])
  })

  it("選択中のグループは、0件でも選択肢から消さない", () => {
    expect(visibleGroups(groups, list, false, "g3").map((g) => g.name)).toEqual(["設計", "空"])
  })
})

describe("normalizeFilters", () => {
  it("足りない項目は既定値で埋め、保存済みの値は保つ", () => {
    expect(normalizeFilters({})).toEqual(DEFAULT_FILTERS)
    expect(normalizeFilters({ status: "running", view: "group", includeArchived: true })).toEqual({
      ...DEFAULT_FILTERS,
      status: "running",
      view: "group",
      includeArchived: true,
    })
  })

  it("組織図が別ページになる前に保存された view: org や、未知の値は、一覧に戻す", () => {
    expect(normalizeFilters({ view: "org" }).view).toBe("list")
    expect(normalizeFilters({ view: "unknown" }).view).toBe("list")
    expect(normalizeFilters({ view: "list" }).view).toBe("list")
  })
})
