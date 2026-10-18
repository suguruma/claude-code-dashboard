import { describe, expect, it } from "vitest"
import {
  MAX_INDIVIDUAL_NOTIFICATIONS,
  buildNotification,
  createNotifyTracker,
  planNotifications,
} from "./desktopNotifications"
import type { DesktopSessionStatus, DesktopSessionSummary } from "./desktopSessionTypes"

function session(id: string, status: DesktopSessionStatus, overrides: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    id,
    title: `セッション${id}`,
    cwd: null,
    folderName: null,
    model: null,
    effort: null,
    permissionMode: null,
    isArchived: false,
    isRoutine: false,
    pinned: false,
    group: null,
    status,
    statusReason: "固定の根拠",
    needsAction: false,
    needsActionExcerpt: null,
    createdAt: null,
    lastActivityAt: null,
    completedTurns: null,
    transcript: "found",
    digest: "full",
    context: null,
    phase: null,
    compactionCount: 0,
    latestInstruction: { excerpt: "会話の本文の抜粋(通知には含めない)", origin: "human", at: null },
    latestInputOrigin: "human",
    queuedInputs: 0,
    cliProcess: "unknown",
    ...overrides,
  }
}

describe("buildNotification", () => {
  it("本文はセッション名と要対応の内容の抜粋だけ(最新の指示などの会話由来の文字列は含めない)", () => {
    const n = buildNotification(session("a", "blocked", { needsActionExcerpt: "本番反映を承認してください" }))
    expect(n).toEqual({ sessionId: "a", title: "要対応: セッションa", body: "本番反映を承認してください" })
    expect(JSON.stringify(n)).not.toContain("会話の本文")
  })

  it("要約文が無い要対応(回答待ちなど)は、状態の根拠を本文にする", () => {
    expect(buildNotification(session("a", "blocked")).body).toBe("固定の根拠")
  })
})

describe("createNotifyTracker", () => {
  it("最初の取得は基準を取るだけで、すでに要対応だったセッションを通知しない", () => {
    const tracker = createNotifyTracker()
    expect(tracker.update([session("a", "blocked"), session("b", "blocked"), session("c", "running")])).toEqual([])
    // 基準のあとも、要対応のままなら通知しない
    expect(tracker.update([session("a", "blocked"), session("b", "blocked"), session("c", "running")])).toEqual([])
  })

  it("新しく要対応になったセッションだけを、1回通知する", () => {
    const tracker = createNotifyTracker()
    tracker.update([session("a", "running"), session("b", "completed")])
    const first = tracker.update([session("a", "blocked"), session("b", "completed")])
    expect(first.map((n) => n.sessionId)).toEqual(["a"])
    // 同じセッションの同じ状態では、再通知しない
    expect(tracker.update([session("a", "blocked"), session("b", "completed")])).toEqual([])
    expect(tracker.update([session("a", "blocked"), session("b", "completed")])).toEqual([])
  })

  it("要対応でなくなってから、また要対応になれば、新たに通知する", () => {
    const tracker = createNotifyTracker()
    tracker.update([session("a", "blocked")])
    expect(tracker.update([session("a", "running")])).toEqual([])
    expect(tracker.update([session("a", "blocked")]).map((n) => n.sessionId)).toEqual(["a"])
  })

  it("基準のあとに現れた新しいセッションが要対応なら通知する", () => {
    const tracker = createNotifyTracker()
    tracker.update([session("a", "completed")])
    expect(tracker.update([session("a", "completed"), session("new", "blocked")]).map((n) => n.sessionId)).toEqual(["new"])
  })

  it("アーカイブ済みは通知しない", () => {
    const tracker = createNotifyTracker()
    tracker.update([session("a", "completed")])
    expect(tracker.update([session("a", "blocked", { isArchived: true })])).toEqual([])
  })

  it("一覧から一時的に消えたセッションが要対応のまま戻っても、再通知しない", () => {
    const tracker = createNotifyTracker()
    tracker.update([session("a", "blocked"), session("b", "completed")])
    expect(tracker.update([session("b", "completed")])).toEqual([])
    expect(tracker.update([session("a", "blocked"), session("b", "completed")])).toEqual([])
  })

  it("要対応以外の状態への変化は通知しない(中断の可能性・エラー・確認待ちなど)", () => {
    const tracker = createNotifyTracker()
    tracker.update([session("a", "running"), session("b", "running"), session("c", "running")])
    expect(tracker.update([session("a", "interrupted"), session("b", "error"), session("c", "review_ready")])).toEqual([])
  })

  it("reset すると基準を取り直し、オンにした時点で要対応だったセッションを通知しない", () => {
    const tracker = createNotifyTracker()
    tracker.update([session("a", "completed")])
    tracker.reset()
    expect(tracker.update([session("a", "blocked")])).toEqual([])
    expect(tracker.update([session("a", "blocked")])).toEqual([])
  })
})

describe("planNotifications", () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ sessionId: `s${i}`, title: `t${i}`, body: "b" }))

  it("件数が少なければそのまま、多ければ先頭を個別に通知して残りを1件にまとめる", () => {
    expect(planNotifications(items(0))).toEqual([])
    expect(planNotifications(items(MAX_INDIVIDUAL_NOTIFICATIONS + 1))).toHaveLength(MAX_INDIVIDUAL_NOTIFICATIONS + 1)
    const many = planNotifications(items(10))
    expect(many).toHaveLength(MAX_INDIVIDUAL_NOTIFICATIONS + 1)
    expect(many[MAX_INDIVIDUAL_NOTIFICATIONS]).toMatchObject({ sessionId: null, title: "ほかに6件が要対応になりました" })
  })
})
