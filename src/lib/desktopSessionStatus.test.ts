import { describe, expect, it } from "vitest"
import { inferStatus } from "./desktopSessionStatus"
import type { DesktopMeta } from "./desktopSessions"
import { WRAP_UP_TOOL, createDigest, type DigestLastRow, type TranscriptDigest } from "./transcriptDigest"

const NOW = 1_000_000_000_000

function meta(overrides: Partial<DesktopMeta> = {}): DesktopMeta {
  return {
    id: "local_x",
    cliSessionId: "cli",
    title: "t",
    cwd: null,
    model: null,
    effort: null,
    permissionMode: null,
    isArchived: false,
    isRoutine: false,
    createdAt: null,
    lastActivityAt: null,
    completedTurns: null,
    statusCategory: null,
    needsAction: false,
    needsActionExcerpt: null,
    summaryFor: null,
    lastAssistantUuid: null,
    hasError: false,
    errorAt: null,
    ...overrides,
  }
}

function digest(lastRow: Partial<DigestLastRow> | null, lastAssistantUuid: string | null = null): TranscriptDigest {
  const d = createDigest()
  d.lastRow = lastRow
    ? { role: "assistant", stopReason: "end_turn", interrupted: false, at: null, toolNames: [], resultOf: null, ...lastRow }
    : null
  d.lastAssistantUuid = lastAssistantUuid
  return d
}

const ago = (sec: number) => NOW - sec * 1000

describe("inferStatus", () => {
  it("ツールの結果待ちで会話ログが新しければ実行中(推定)", () => {
    const r = inferStatus({ meta: meta(), digest: digest({ stopReason: "tool_use" }), transcriptMtimeMs: ago(120), now: NOW })
    expect(r.status).toBe("running")
    expect(r.reason).toContain("推定")
  })

  it("ユーザーの入力・ツール結果の直後で新しければ実行中", () => {
    const r = inferStatus({ meta: meta(), digest: digest({ role: "user", stopReason: null }), transcriptMtimeMs: ago(30), now: NOW })
    expect(r.status).toBe("running")
  })

  it("同じ状態のまま更新が止まっていれば中断の可能性", () => {
    const r = inferStatus({ meta: meta({ statusCategory: "completed" }), digest: digest({ stopReason: "tool_use" }), transcriptMtimeMs: ago(3600), now: NOW })
    expect(r.status).toBe("interrupted")
  })

  it("会話以外の書き込みでファイルの更新時刻だけが新しくなっても、止まったセッションを実行中にしない", () => {
    const d = digest({ stopReason: "tool_use" })
    d.lastEventAt = ago(7200)
    const r = inferStatus({ meta: meta({ statusCategory: "completed", summaryFor: "old" }), digest: d, transcriptMtimeMs: ago(1000), now: NOW })
    expect(r.status).toBe("interrupted")
    expect(r.reason).toContain("会話が")
  })

  it("ユーザーによる中断の行は、ツール待ちとは扱わない", () => {
    const r = inferStatus({
      meta: meta({ statusCategory: "review_ready" }),
      digest: digest({ role: "user", stopReason: null, interrupted: true }),
      transcriptMtimeMs: ago(3600),
      now: NOW,
    })
    expect(r.status).toBe("review_ready")
  })

  it("ターン後の要約が最後の応答に対応していれば、終了直後の書き込みを実行中と誤判定しない", () => {
    const r = inferStatus({
      meta: meta({ statusCategory: "completed", summaryFor: "a1" }),
      digest: digest({ stopReason: "end_turn" }, "a1"),
      transcriptMtimeMs: ago(5),
      now: NOW,
    })
    expect(r.status).toBe("completed")
  })

  it("ターン終了直後で要約がまだ無ければ、更新が新しい間は実行中と表示する", () => {
    const r = inferStatus({ meta: meta(), digest: digest({ stopReason: "end_turn" }, "a1"), transcriptMtimeMs: ago(10), now: NOW })
    expect(r.status).toBe("running")
  })

  it("Desktopの分類をそのまま使う: 要対応・確認待ち・完了", () => {
    const base = { digest: digest({ stopReason: "end_turn" }, "a1"), transcriptMtimeMs: ago(3600), now: NOW }
    expect(inferStatus({ ...base, meta: meta({ statusCategory: "blocked", summaryFor: "a1" }) }).status).toBe("blocked")
    expect(inferStatus({ ...base, meta: meta({ statusCategory: "review_ready", summaryFor: "a1" }) }).status).toBe("review_ready")
    expect(inferStatus({ ...base, meta: meta({ statusCategory: "completed", summaryFor: "a1" }) }).status).toBe("completed")
  })

  it("分類が無くターンが終わっていれば入力待ち、材料が無ければ不明", () => {
    expect(inferStatus({ meta: meta(), digest: digest({ stopReason: "end_turn" }), transcriptMtimeMs: ago(3600), now: NOW }).status).toBe("waiting")
    expect(inferStatus({ meta: meta(), digest: null, transcriptMtimeMs: null, now: NOW }).status).toBe("unknown")
  })

  it("エラーが記録されていて動いていなければ error", () => {
    const r = inferStatus({ meta: meta({ hasError: true, statusCategory: "completed" }), digest: digest({ stopReason: "end_turn" }), transcriptMtimeMs: ago(3600), now: NOW })
    expect(r.status).toBe("error")
  })

  it("会話ログが無くても、メタデータの最終活動が新しければ実行中", () => {
    const r = inferStatus({ meta: meta({ lastActivityAt: ago(10) }), digest: null, transcriptMtimeMs: null, now: NOW })
    expect(r.status).toBe("running")
  })

  it("縮退表示(メタデータ無し)でも状態を推定できる", () => {
    expect(inferStatus({ meta: null, digest: digest({ stopReason: "end_turn" }), transcriptMtimeMs: ago(3600), now: NOW }).status).toBe("waiting")
    expect(inferStatus({ meta: null, digest: digest({ stopReason: "tool_use" }), transcriptMtimeMs: ago(20), now: NOW }).status).toBe("running")
  })

  it("しきい値は引数で変えられる", () => {
    const r = inferStatus(
      { meta: meta({ statusCategory: "completed" }), digest: digest({ stopReason: "tool_use" }), transcriptMtimeMs: ago(120), now: NOW },
      { runningWindowMs: 1000, pendingWindowMs: 60_000 }
    )
    expect(r.status).toBe("interrupted")
  })
  it("AskUserQuestion を呼び出したまま止まっているのは、中断ではなく回答待ち(要対応)", () => {
    const base = { meta: meta({ statusCategory: "completed", summaryFor: "old" }), now: NOW }
    const asked = digest({ stopReason: "tool_use", toolNames: ["Read", "AskUserQuestion"] })
    // 質問した直後でも、何日も経っていても、実行中・中断ではなく要対応にする
    for (const sec of [5, 3600, 86_400 * 30]) {
      const r = inferStatus({ ...base, digest: asked, transcriptMtimeMs: ago(sec) })
      expect(r.status).toBe("blocked")
      expect(r.reason).toContain("回答待ち")
    }
  })

  it("ExitPlanMode の承認待ちも要対応", () => {
    const r = inferStatus({
      meta: meta(),
      digest: digest({ stopReason: "tool_use", toolNames: ["ExitPlanMode"] }),
      transcriptMtimeMs: ago(7200),
      now: NOW,
    })
    expect(r.status).toBe("blocked")
    expect(r.reason).toContain("プランの承認待ち")
  })

  it("ユーザーが回答したあと(最後がユーザーの行)は、回答待ちとは扱わない", () => {
    const r = inferStatus({
      meta: meta(),
      digest: digest({ role: "user", stopReason: null, toolNames: [] }),
      transcriptMtimeMs: ago(30),
      now: NOW,
    })
    expect(r.status).toBe("running")
  })

  it("wrap_up の結果の行で終わっていれば、ターン後の要約が無くても中断ではなく入力待ち", () => {
    const wrapped = digest({ role: "user", stopReason: null, resultOf: WRAP_UP_TOOL })
    expect(inferStatus({ meta: meta(), digest: wrapped, transcriptMtimeMs: ago(7200), now: NOW }).status).toBe("waiting")
    // Desktopの分類があればそれを使う
    expect(
      inferStatus({ meta: meta({ statusCategory: "review_ready", summaryFor: "x" }), digest: wrapped, transcriptMtimeMs: ago(7200), now: NOW }).status
    ).toBe("review_ready")
  })

  it("ほかのツールの結果の行で止まっていれば、従来どおり中断の可能性", () => {
    const stuck = digest({ role: "user", stopReason: null, resultOf: "Bash" })
    expect(inferStatus({ meta: meta(), digest: stuck, transcriptMtimeMs: ago(7200), now: NOW }).status).toBe("interrupted")
  })

  it("長いコマンド(Bash・PowerShellのタイムアウト上限10分)の実行中を、中断と誤判定しない", () => {
    const d = digest({ stopReason: "tool_use", toolNames: ["Bash"] })
    d.lastEventAt = ago(9 * 60)
    expect(inferStatus({ meta: meta(), digest: d, transcriptMtimeMs: ago(9 * 60), now: NOW }).status).toBe("running")
    d.lastEventAt = ago(12 * 60)
    expect(inferStatus({ meta: meta(), digest: d, transcriptMtimeMs: ago(12 * 60), now: NOW }).status).toBe("interrupted")
  })

  it("エラーの記録より後に活動があれば、回復済みとしてエラーにしない", () => {
    const base = { digest: digest({ stopReason: "end_turn" }), transcriptMtimeMs: ago(7200), now: NOW }
    const errored = { hasError: true, statusCategory: "completed" as const, summaryFor: "x" }
    // 活動の時刻がエラーと同じ(エラーで止まっている)ならエラー
    expect(inferStatus({ ...base, meta: meta({ ...errored, errorAt: ago(3600), lastActivityAt: ago(3600) }) }).status).toBe("error")
    // エラーより後にメタデータの最終活動がある
    expect(inferStatus({ ...base, meta: meta({ ...errored, errorAt: ago(3600), lastActivityAt: ago(600) }) }).status).toBe("completed")
    // エラーより後に会話が進んでいる
    const later = digest({ stopReason: "end_turn" })
    later.lastEventAt = ago(300)
    expect(inferStatus({ ...base, digest: later, meta: meta({ ...errored, errorAt: ago(3600), lastActivityAt: ago(3600) }) }).status).toBe("completed")
    // エラーの時刻が分からなければ、エラーとして扱う
    expect(inferStatus({ ...base, meta: meta({ ...errored, errorAt: null, lastActivityAt: ago(60) }) }).status).toBe("error")
  })
})
