import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { makeSessionSummary } from "./desktopFixtures"
import type { DesktopSessionMessaging } from "./desktopSessionTypes"
import { buildInbox, countText, isUnread, markRead, markUnread, parseReadTargets, pruneReads, unreadCount, type InboxRead } from "./inbox"
import { InboxReadStore } from "./inboxReadStore"
import { LAN_HEADER } from "./lanAccess/config"
import type { MonitorAlertSummary } from "./monitor/monitorTypes"
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
