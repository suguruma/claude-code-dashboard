import { describe, expect, it } from "vitest"
import {
  MAX_INDIVIDUAL_NOTIFICATIONS,
  buildNotification,
  buildSendLimitNotification,
  createNotifyTracker,
  planNotifications,
} from "./desktopNotifications"
import type { DesktopSessionMessaging, DesktopSessionStatus, DesktopSessionSummary } from "./desktopSessionTypes"

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
    messaging: null,
    cliProcess: "unknown",
    spawnedFromId: null,
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
    expect(many[MAX_INDIVIDUAL_NOTIFICATIONS]).toMatchObject({ sessionId: null, title: "ほかに6件の通知があります" })
  })
})

describe("送信上限での停止の通知", () => {
  const messaging = (over: Partial<DesktopSessionMessaging> = {}): DesktopSessionMessaging => ({
    sent: 3,
    limit: 10,
    stopped: false,
    undelivered: 0,
    exact: true,
    ...over,
  })
  const stoppedMessaging = messaging({ sent: 10, stopped: true, undelivered: 1 })
  const withMessaging = (id: string, m: DesktopSessionMessaging | null, overrides: Partial<DesktopSessionSummary> = {}) =>
    session(id, "running", { messaging: m, ...overrides })

  it("通知の本文は固定の文言とセッション名だけで、会話の本文を含めない", () => {
    const n = buildSendLimitNotification(withMessaging("a", stoppedMessaging))
    expect(n).toMatchObject({ sessionId: "a", title: "送信上限で停止: セッションa" })
    expect(n.body).toContain("一言入力すると解除")
    expect(JSON.stringify(n)).not.toContain("会話の本文")
  })

  it("新しく停止中になったセッションを、1回だけ通知する", () => {
    const tracker = createNotifyTracker()
    tracker.update([withMessaging("a", messaging()), withMessaging("b", messaging())])
    const first = tracker.update([withMessaging("a", stoppedMessaging), withMessaging("b", messaging())])
    expect(first.map((n) => n.sessionId)).toEqual(["a"])
    expect(first[0].title).toBe("送信上限で停止: セッションa")
    // 停止中のあいだは再通知しない
    expect(tracker.update([withMessaging("a", stoppedMessaging), withMessaging("b", messaging())])).toEqual([])
  })

  it("最初の取得で、すでに停止中だったセッションは通知しない（基準）", () => {
    const tracker = createNotifyTracker()
    expect(tracker.update([withMessaging("a", stoppedMessaging)])).toEqual([])
    expect(tracker.update([withMessaging("a", stoppedMessaging)])).toEqual([])
  })

  it("解除されたあと、また停止中になれば、新たに通知する", () => {
    const tracker = createNotifyTracker()
    tracker.update([withMessaging("a", stoppedMessaging)])
    expect(tracker.update([withMessaging("a", messaging({ sent: 0 }))])).toEqual([])
    expect(tracker.update([withMessaging("a", stoppedMessaging)]).map((n) => n.sessionId)).toEqual(["a"])
  })

  it("基準のあとに現れた新しいセッションが停止中なら通知する", () => {
    const tracker = createNotifyTracker()
    tracker.update([withMessaging("a", messaging())])
    expect(tracker.update([withMessaging("a", messaging()), withMessaging("new", stoppedMessaging)]).map((n) => n.sessionId)).toEqual([
      "new",
    ])
  })

  it("暫定の要約で判断できなかったセッションが、あとで停止中と分かっても通知しない（古い停止を新しい停止と取り違えない）", () => {
    const tracker = createNotifyTracker()
    const unknown = messaging({ sent: 0, exact: false })
    tracker.update([withMessaging("a", unknown)])
    expect(tracker.update([withMessaging("a", unknown)])).toEqual([])
    // 全体を読み終えて、止まっていたと分かった
    expect(tracker.update([withMessaging("a", stoppedMessaging)])).toEqual([])
    // 以後は解除→再停止で通知する
    tracker.update([withMessaging("a", messaging({ sent: 0 }))])
    expect(tracker.update([withMessaging("a", stoppedMessaging)]).map((n) => n.sessionId)).toEqual(["a"])
  })

  it("暫定の要約でも、停止中と検出できていれば確定した値として扱い、新しく止まったなら通知する", () => {
    const tracker = createNotifyTracker()
    tracker.update([withMessaging("a", messaging())])
    const partialStopped = messaging({ sent: 10, stopped: true, exact: true })
    expect(tracker.update([withMessaging("a", partialStopped)]).map((n) => n.sessionId)).toEqual(["a"])
  })

  it("会話ログが無いセッション・アーカイブ済みは通知しない", () => {
    const tracker = createNotifyTracker()
    tracker.update([withMessaging("a", null), withMessaging("b", messaging())])
    expect(
      tracker.update([withMessaging("a", null), withMessaging("b", stoppedMessaging, { isArchived: true })])
    ).toEqual([])
  })

  it("要対応と停止中が同時に起きれば、両方を通知する。reset すると基準を取り直す", () => {
    const tracker = createNotifyTracker()
    tracker.update([withMessaging("a", messaging())])
    const items = tracker.update([session("a", "blocked", { messaging: stoppedMessaging })])
    expect(items.map((n) => n.title)).toEqual(["要対応: セッションa", "送信上限で停止: セッションa"])

    tracker.reset()
    expect(tracker.update([withMessaging("a", stoppedMessaging)])).toEqual([])
  })
})
