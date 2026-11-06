import { describe, expect, it } from "vitest"
import { makeSessionSummary } from "./desktopFixtures"
import type { DesktopSessionMessaging, DesktopSessionStatus } from "./desktopSessionTypes"
import { buildNextDecisions } from "./nextDecisions"
import { buildBoard, holdOrder, QUIET_AFTER_MS } from "./sessionBoard"
import { buildMarks } from "./statusMark"

// 値はどれも合成
const NOW = 1_800_000_000_000
const MIN = 60_000
const messaging = (o: Partial<DesktopSessionMessaging>): DesktopSessionMessaging => ({ sent: 10, limit: 10, stopped: false, undelivered: 0, exact: true, ...o })
const s = (id: string, status: DesktopSessionStatus, agoMin: number, extra: object = {}) => makeSessionSummary(id, { status, lastActivityAt: NOW - agoMin * MIN, ...extra })
const ids = (list: { id: string }[]) => list.map((x) => x.id)

describe("[OR-3] 看板の列", () => {
  const sessions = [
    s("blk", "blocked", 30),
    s("err", "error", 40),
    s("lim", "waiting", 50, { messaging: messaging({ stopped: true }) }),
    s("run", "running", 1),
    s("int", "interrupted", 3 * 24 * 60),
    s("rev", "review_ready", 5 * 24 * 60),
    s("std", "standby", 10),
    s("wait-old", "waiting", 26 * 60),
    s("wait-old-unread", "waiting", 30 * 60),
    s("comp-old", "completed", 40 * 60),
    s("unk", "unknown", 60),
    s("arc", "blocked", 5, { isArchived: true }),
  ]
  const marks = buildMarks(sessions, NOW)
  const board = buildBoard(sessions, marks, (x) => x.id === "wait-old-unread", NOW)

  it("対応表のとおりに分ける。確認待ち・中断の可能性・エラーは静かに入らない。アーカイブ済みは出さない", () => {
    expect(ids(board.decision).sort()).toEqual(["blk", "err", "lim"])
    expect(ids(board.running)).toEqual(["run"])
    expect(ids(board.stopped)).toEqual(["int"])
    expect(ids(board.done).sort()).toEqual(["rev", "std", "unk", "wait-old-unread"])
    expect(ids(board.quiet).sort()).toEqual(["comp-old", "wait-old"])
  })

  it("判断の列の件数は、ホームの次にやる判断と同じ。列の合計は、表示中の件数と同じ(取りこぼし0)", () => {
    expect(board.decision).toHaveLength(buildNextDecisions(sessions, NOW).length)
    const total = Object.values(board).reduce((n, c) => n + c.length, 0)
    expect(total).toBe(sessions.filter((x) => !x.isArchived).length)
  })

  it("完了の列は未読と直近24時間。24時間を過ぎた既読は静か", () => {
    const edge = [s("in", "completed", QUIET_AFTER_MS / MIN), s("out", "completed", QUIET_AFTER_MS / MIN + 1)]
    const b = buildBoard(edge, buildMarks(edge, NOW), () => false, NOW)
    expect(ids(b.done)).toEqual(["in"])
    expect(ids(b.quiet)).toEqual(["out"])
  })

  it("[A13] 列の中は 急ぐ順 → 新しい順 → ID で、読み直しても同じ順。並びを止めている間は前の順を保ち、新しい物は最後", () => {
    const again = buildBoard([...sessions].reverse(), marks, (x) => x.id === "wait-old-unread", NOW)
    expect(ids(again.done)).toEqual(ids(board.done))
    expect(ids(board.done)).toEqual(["std", "wait-old-unread", "rev", "unk"])
    const next = [s("b", "standby", 1), s("new", "standby", 0), s("a", "standby", 2)]
    expect(ids(holdOrder(["a", "gone", "b"], next))).toEqual(["a", "b", "new"])
  })
})
