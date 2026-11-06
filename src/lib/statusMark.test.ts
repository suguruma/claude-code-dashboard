import { describe, expect, it } from "vitest"
import { makeSessionSummary } from "./desktopFixtures"
import type { DesktopNeedsActionInfo, DesktopSessionMessaging, DesktopSessionStatus } from "./desktopSessionTypes"
import { buildNextDecisions } from "./nextDecisions"
import { buildMarks, markOfStatus, quietMark } from "./statusMark"

// 値はどれも合成
const NOW = 1_800_000_000_000
const MIN = 60_000
const needs = (kind: DesktopNeedsActionInfo["kind"], estimated = false): DesktopNeedsActionInfo => ({
  kind,
  source: estimated ? "summary-words" : "wrap-up-ask",
  estimated,
  buttons: [],
})
const messaging = (o: Partial<DesktopSessionMessaging>): DesktopSessionMessaging => ({ sent: 3, limit: 10, stopped: false, undelivered: 0, exact: true, ...o })
const pick = (m: ReturnType<typeof buildMarks>, id: string) => {
  const x = m.get(id)!
  return `${x.symbol} ${x.text} ${x.tone}${x.estimated ? " 推定" : ""}`
}

describe("[OR-2] 状態の印(要件メモ 4-2 の対応表)", () => {
  it("判断に入る物は、次にやる判断の段の色と「？」「×」になる", () => {
    const at = NOW - 30 * MIN
    const sessions = [
      makeSessionSummary("perm", { status: "blocked", needsActionInfo: needs("permission", true), lastActivityAt: at }),
      makeSessionSummary("appr", { status: "blocked", needsActionInfo: needs("approval"), lastActivityAt: at }),
      makeSessionSummary("q", { status: "blocked", needsActionInfo: needs("decision"), lastActivityAt: at }),
      makeSessionSummary("q-long", { status: "blocked", needsActionInfo: needs("decision"), lastActivityAt: NOW - 3 * 60 * MIN }),
      makeSessionSummary("unk", { status: "blocked", needsActionInfo: needs("unknown"), lastActivityAt: at }),
      makeSessionSummary("limit", { status: "waiting", messaging: messaging({ sent: 10, stopped: true }), lastActivityAt: at }),
      makeSessionSummary("undel", { status: "waiting", messaging: messaging({ undelivered: 2 }), lastActivityAt: at }),
      makeSessionSummary("err", { status: "error", lastActivityAt: at }),
    ]
    const m = buildMarks(sessions, NOW)
    expect(pick(m, "perm")).toBe("？ 判断・許可 red 推定")
    expect(pick(m, "appr")).toBe("？ 判断・承認 amber")
    expect(pick(m, "q")).toBe("？ 判断・質問 gray")
    expect(pick(m, "q-long")).toBe("？ 判断・質問 amber")
    expect(pick(m, "unk")).toBe("？ 判断 gray")
    expect(pick(m, "limit")).toBe("× 送信上限 red")
    expect(pick(m, "undel")).toBe("？ 判断・届かない送信 amber")
    expect(pick(m, "err")).toBe("× エラー red")
    for (const s of sessions) expect(m.get(s.id)?.decision).toBe(true)
  })

  it("判断でない物は状態で決まり、9つの状態のどれにも印がある", () => {
    const expected: Record<DesktopSessionStatus, string> = {
      running: "◌ 作業中 blue 推定",
      interrupted: "‖ 止まったかも amber 推定",
      review_ready: "● 確認待ち green",
      completed: "● 完了 green",
      standby: "● 待機 green",
      waiting: "● 入力待ち green",
      unknown: "● 不明 gray",
      blocked: "？ 判断 gray",
      error: "× エラー red",
    }
    for (const [status, text] of Object.entries(expected) as [DesktopSessionStatus, string][]) {
      // アーカイブ済みは判断に集めないので、状態からの印になる
      const m = buildMarks([makeSessionSummary("s", { status, isArchived: true })], NOW)
      expect(pick(m, "s")).toBe(text)
    }
    expect(markOfStatus({ status: "standby", standbyInfo: { estimated: true } as never }).estimated).toBe(true)
  })

  it("判断の印の数は、ホームの次にやる判断の件数と同じ(サイドバーの「判断 n」)", () => {
    const sessions = [
      makeSessionSummary("a", { status: "blocked", needsActionInfo: needs("decision") }),
      makeSessionSummary("b", { status: "running" }),
      makeSessionSummary("c", { status: "error" }),
      makeSessionSummary("d", { status: "waiting", messaging: messaging({ undelivered: 1 }) }),
      makeSessionSummary("e", { status: "completed" }),
      makeSessionSummary("f", { status: "blocked", isArchived: true }),
    ]
    const m = buildMarks(sessions, NOW)
    expect([...m.values()].filter((x) => x.decision)).toHaveLength(buildNextDecisions(sessions, NOW).length)
    expect(buildNextDecisions(sessions, NOW)).toHaveLength(3)
  })

  it("静かの印は灰の「－」で、もとの状態の文字を残す", () => {
    expect(quietMark(markOfStatus({ status: "completed", standbyInfo: null }))).toMatchObject({ symbol: "－", text: "静か・完了", tone: "gray" })
  })

  it("同じ一覧と同じ分なら、計算し直さない", () => {
    const sessions = [makeSessionSummary("a", { status: "running" })]
    expect(buildMarks(sessions, NOW)).toBe(buildMarks(sessions, NOW + 1000))
    expect(buildMarks(sessions, NOW)).not.toBe(buildMarks(sessions, NOW + 2 * MIN))
  })
})
