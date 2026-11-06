import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { makeSessionSummary } from "./desktopFixtures"
import type { DesktopSessionMessaging } from "./desktopSessionTypes"
import {
  BASE_TARGET,
  baseSeenAt,
  bellCoversSinceBase,
  buildInbox,
  countText,
  isUnread,
  markRead,
  markUnread,
  parseReadTargets,
  pruneReads,
  unreadCount,
  viewBase,
  type InboxRead,
} from "./inbox"
import { InboxReadStore } from "./inboxReadStore"
import { LAN_HEADER } from "./lanAccess/config"
import type { MonitorAlertSummary } from "./monitor/monitorTypes"
import { buildBoard } from "./sessionBoard"
import { buildMarks } from "./statusMark"
import type { UsageResponse, UsageWindowView } from "./usageTypes"

// 値はどれも合成
const NOW = 1_800_000_000_000
const MIN = 60_000
const DAY = 24 * 60 * MIN
const messaging = (o: Partial<DesktopSessionMessaging>): DesktopSessionMessaging => ({ sent: 10, limit: 10, stopped: false, undelivered: 0, exact: true, ...o })
const sessions = [
  makeSessionSummary("q", { title: "判断_方針", status: "blocked", lastActivityAt: NOW - 30 * MIN }),
  makeSessionSummary("t", { title: "00_リーダー", status: "standby", lastActivityAt: NOW - 12 * MIN }),
  makeSessionSummary("l", { title: "03_検証", status: "waiting", messaging: messaging({ stopped: true }), lastActivityAt: NOW - 50 * MIN }),
  makeSessionSummary("old", { title: "昔の完了", status: "completed", lastActivityAt: NOW - 2 * DAY }),
  makeSessionSummary("run", { title: "作業中", status: "running", lastActivityAt: NOW - 1 * MIN }),
  makeSessionSummary("arc", { title: "アーカイブ", status: "blocked", isArchived: true, lastActivityAt: NOW - 5 * MIN }),
]
const alerts = {
  configured: true,
  generatedAt: NOW,
  today: true,
  items: [{ key: "cpu", active: false, count: 1, band: { start: NOW - 70 * MIN, end: NOW - 60 * MIN, max: 92, peakAt: NOW - 65 * MIN, threshold: 90 } }],
} as MonitorAlertSummary
const win = (id: string, displayPercent: number) => ({ id, key: id, label: "5時間", modelName: null, resetsAt: NOW + 60 * MIN, displayPercent, official: { percentUsed: displayPercent, recordedAt: NOW - 20 * MIN, resetsAt: NOW + 60 * MIN } }) as unknown as UsageWindowView
const usage = { generatedAt: NOW, windows: [win("five_hour", 83), win("weekly_all", 41)], guard: null } as unknown as UsageResponse
const sources = { sessions, marks: buildMarks(sessions, NOW), alerts, usage, now: NOW }

describe("[OR-4] 知らせの鐘", () => {
  it("5種の知らせを、時刻つきの記録から1件ずつ組み立てる(新しい順)。24時間より前の終わり・作業中・アーカイブ済みは入れない", () => {
    const items = buildInbox(sources)
    expect(items.map((i) => `${i.kind}:${i.target}`)).toEqual(["turn-end:t", "usage:usage:five_hour", "decision:q", "send-limit:l", "pc-alert:pc:cpu"])
    expect(unreadCount(items, [])).toBe(5)
    // 判断待ちの知らせの元は、サイドバーの「判断 n」と同じ印
    const decisionMarks = [...sources.marks.values()].filter((m) => m.decision).length
    expect(items.filter((i) => i.kind === "decision" || i.kind === "send-limit")).toHaveLength(decisionMarks)
    // 知らせに会話の本文は入れない
    expect(items.every((i) => !i.what.includes("判断_方針"))).toBe(true)
  })

  it("行を見ると1つ減り、すべて既読で0。後から同じ対象に新しい知らせが来れば、また未読", () => {
    const items = buildInbox(sources)
    let reads: InboxRead[] = markRead([], [{ target: "q", kind: "decision" }], NOW)
    expect(unreadCount(items, reads)).toBe(4)
    reads = markRead(reads, items.map((i) => ({ target: i.target, kind: i.kind })), NOW)
    expect(unreadCount(items, reads)).toBe(0)
    const later = buildInbox({ ...sources, sessions: sessions.map((s) => (s.id === "t" ? { ...s, lastActivityAt: NOW + 5 * MIN } : s)), now: NOW + 6 * MIN })
    expect(later.filter((i) => isUnread(i, reads)).map((i) => i.target)).toEqual(["t"])
    expect(unreadCount(items, markUnread(reads, [{ target: "q", kind: "decision" }]))).toBe(1)
  })

  it("鐘の数は100以上で「99+」", () => {
    expect(countText(5)).toBe("5")
    expect(countText(99)).toBe("99")
    expect(countText(100)).toBe("99+")
  })
})

describe("[OR-3][OR-4] 基準の時刻(最後に看板か鐘を見た時刻。指示56 案1)", () => {
  const BASE = { target: BASE_TARGET, kind: "turn-end" as const }
  const old = makeSessionSummary("old3", { title: "3日前の完了", status: "completed", lastActivityAt: NOW - 3 * DAY })
  const unknown = makeSessionSummary("unk", { title: "不明", status: "unknown", lastActivityAt: NOW - 2 * 60 * MIN })
  /** 看板の列(鐘と同じ判定。base は画面で使う基準の時刻) */
  const columnOfOld = (reads: InboxRead[], base: number | null, now = NOW) => {
    const all = [old, unknown]
    const board = buildBoard(all, buildMarks(all, now), (x) => x.lastActivityAt !== null && isUnread({ target: x.id, kind: "turn-end", at: x.lastActivityAt }, reads, base), now)
    return (Object.keys(board) as Array<keyof typeof board>).find((c) => board[c].some((x) => x.id === "old3"))
  }

  it("既読の記録が無くても、基準より前に終わった物は既読とみなし、24時間より前なら静かに入る", () => {
    // 4日前に看板を見た → 3日前に終わった物は、見た後に終わったので未読(閉じていた間の分も出る)
    expect(columnOfOld([], NOW - 4 * DAY)).toBe("done")
    // 2日前に看板を見た → 見る前に終わっていたので既読 → 静か
    const reads = markRead([], [BASE], NOW - 2 * DAY)
    expect(baseSeenAt(reads)).toBe(NOW - 2 * DAY)
    expect(columnOfOld(reads, viewBase(reads, NOW))).toBe("quiet")
    // 初めて(基準の行が無い)ときは24時間前を基準にし、それより前に終わった物は未読として並べない
    expect(viewBase([], NOW)).toBe(NOW - 24 * 60 * MIN)
    expect(columnOfOld([], viewBase([], NOW))).toBe("quiet")
  })

  it("鐘に出ない24時間より前の物も、すべて既読(基準を今に)で既読になり、静かへ移る", () => {
    const watched = NOW - 4 * DAY
    expect(columnOfOld([], watched)).toBe("done")
    // すべて既読：鐘の未読の行と基準の行を今の時刻で書く
    const inbox = buildInbox({ ...sources, sessions: [old], marks: buildMarks([old], NOW) })
    expect(inbox.some((i) => i.target === "old3")).toBe(false)
    const reads = markRead([], [...inbox.filter((i) => isUnread(i, [], watched)), BASE], NOW)
    expect(columnOfOld(reads, viewBase(reads, NOW))).toBe("quiet")
  })

  it("見た記録が30日で消えても、基準の行は残るので、静かの物は完了(未読)へ戻らない", async () => {
    // 31日前に見た(既読の行)。基準も同じ時刻
    const seen = NOW - 31 * DAY
    const old32 = { ...old, lastActivityAt: NOW - 32 * DAY }
    const reads = pruneReads(markRead([], [{ target: "old3", kind: "turn-end" }, BASE], seen), NOW)
    expect(reads.some((r) => r.target === "old3")).toBe(false)
    expect(reads).toEqual([{ target: BASE_TARGET, kind: "turn-end", seenAt: seen }])
    const all = [old32]
    const board = buildBoard(all, buildMarks(all, NOW), (x) => isUnread({ target: x.id, kind: "turn-end", at: x.lastActivityAt! }, reads, viewBase(reads, NOW)), NOW)
    expect(board.quiet.map((x) => x.id)).toEqual(["old3"])
  })

  it("状態「不明」も鐘の「ターンが終わった」に入り、既読にできる", () => {
    const items = buildInbox({ ...sources, sessions: [unknown], marks: buildMarks([unknown], NOW) })
    expect(items.map((i) => `${i.kind}:${i.target}`)).toContain("turn-end:unk")
    const reads = markRead([], [{ target: "unk", kind: "turn-end" }], NOW)
    expect(unreadCount(items.filter((i) => i.target === "unk"), reads)).toBe(0)
  })

  it("基準より前に終わった物も「未読に戻す」で未読になり、30日(戻した時刻から)で印が消える", () => {
    const BASE_AT = NOW - 1 * 60 * MIN
    const item = { target: "unk", kind: "turn-end" as const, at: NOW - 2 * 60 * MIN }
    let reads = markRead([], [BASE, { target: "unk", kind: "turn-end" }], BASE_AT)
    expect(isUnread(item, reads, viewBase(reads, NOW))).toBe(false)
    reads = markUnread(reads, [{ target: "unk", kind: "turn-end" }], NOW)
    expect(isUnread(item, reads, viewBase(reads, NOW))).toBe(true)
    // 印は形が同じ(見た時刻・対象・種類だけ)で、30日は残る
    expect(pruneReads(reads, NOW + 29 * DAY).some((r) => r.target === "unk")).toBe(true)
    expect(pruneReads(reads, NOW + 31 * DAY).some((r) => r.target === "unk")).toBe(false)
    // もう一度見れば既読
    reads = markRead(reads, [{ target: "unk", kind: "turn-end" }], NOW + MIN)
    expect(isUnread(item, reads, viewBase(reads, NOW + MIN))).toBe(false)
  })

  it("鐘を開いても、鐘に出ない古い物は見たことにしない(基準が24時間より前なら進めない)。鐘から看板へ移っても未読のまま", () => {
    const stored = markRead([], [BASE], NOW - 4 * DAY)
    const items = buildInbox(sources)
    expect(bellCoversSinceBase(stored, items, NOW)).toBe(false)
    // 鐘で進めなかったので、看板を開いたときの基準は4日前のまま → 3日前に終わった物は未読(完了の列)
    expect(columnOfOld(stored, viewBase(stored, NOW))).toBe("done")
    // 基準が鐘の範囲(24時間)の中なら、鐘を開いた時刻へ進めてよい
    expect(bellCoversSinceBase(markRead([], [BASE], NOW - 3 * 60 * MIN), items, NOW)).toBe(true)
    // 初めて(基準の行が無い)は24時間前を基準にするので、進めてよい
    expect(bellCoversSinceBase([], items, NOW)).toBe(true)
  })

  it("鐘が20件で切れているときは、20件目より前に基準があっても進めない", () => {
    const many = Array.from({ length: 25 }, (_, i) => makeSessionSummary(`m${i}`, { title: `完了${i}`, status: "completed", lastActivityAt: NOW - (i + 1) * 10 * MIN }))
    const items = buildInbox({ ...sources, sessions: many, marks: buildMarks(many, NOW), alerts: null, usage: null })
    expect(items).toHaveLength(25)
    // 20件目は200分前。基準が5時間前だと、その間の5件が鐘に出ていない
    expect(bellCoversSinceBase(markRead([], [BASE], NOW - 5 * 60 * MIN), items, NOW)).toBe(false)
    expect(bellCoversSinceBase(markRead([], [BASE], NOW - 150 * MIN), items, NOW)).toBe(true)
  })

  it("基準の行は既読の記録と同じ形(見た時刻・対象・種類だけ)で、知らせの対象にはならない", () => {
    expect(parseReadTargets({ items: [BASE] })).toEqual([BASE])
    expect(buildInbox(sources).some((i) => i.target === BASE_TARGET)).toBe(false)
  })
})

describe("[OR-4] 既読の記録(config/inbox-read.json)", () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
  })
  const tmpFile = async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-inbox-read-"))
    dirs.push(dir)
    return path.join(dir, "config", "inbox-read.json")
  }

  it("中身は見た時刻・対象の ID・知らせの種類だけ。開き直しても残り、30日より前は消える", async () => {
    const file = await tmpFile()
    let now = NOW
    const store = new InboxReadStore({ filePath: () => file, now: () => now })
    await store.update({ items: [{ target: "local_a", kind: "decision" }, { target: "pc:cpu", kind: "pc-alert" }] })
    const raw = JSON.parse(await fs.readFile(file, "utf-8"))
    expect(raw).toEqual({ reads: [{ target: "local_a", kind: "decision", seenAt: NOW }, { target: "pc:cpu", kind: "pc-alert", seenAt: NOW }] })
    // 開き直し(別のストア)でも読める
    expect((await new InboxReadStore({ filePath: () => file, now: () => now }).get()).reads).toHaveLength(2)
    await store.update({ items: [{ target: "local_a", kind: "decision" }], unread: true })
    expect((await store.get()).reads.map((r) => r.target)).toEqual(["pc:cpu"])
    now = NOW + 31 * DAY
    expect((await store.get()).reads).toEqual([])
  })

  it("形の違う入力は断る(題名などの余分な項目は持たない)", async () => {
    const store = new InboxReadStore({ filePath: await tmpFile().then((f) => () => f), now: () => NOW })
    await expect(store.update({ items: [{ target: "a b", kind: "decision" }] })).rejects.toThrow()
    await expect(store.update({ items: [{ target: "local_a", kind: "other" }] })).rejects.toThrow()
    await expect(store.update({ items: [] })).rejects.toThrow()
    expect(parseReadTargets({ items: [{ target: "local_a", kind: "turn-end", title: "題名" }] })).toEqual([{ target: "local_a", kind: "turn-end" }])
    expect(pruneReads([{ target: "local_a", kind: "decision", seenAt: NOW }, { target: 1 }], NOW)).toHaveLength(1)
  })

  it("スマホ(LAN の入口)からの読み書きは 403", async () => {
    const { GET, POST } = await import("@/app/api/inbox-read/route")
    const headers = { [LAN_HEADER]: "1", "content-type": "application/json" }
    const post = await POST(new Request("http://127.0.0.1/api/inbox-read", { method: "POST", headers, body: JSON.stringify({ items: [{ target: "local_a", kind: "decision" }] }) }) as never)
    expect(post.status).toBe(403)
    expect((await GET(new Request("http://127.0.0.1/api/inbox-read", { headers }))).status).toBe(403)
  })
})
