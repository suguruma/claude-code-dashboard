import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { HELP_ITEM, NAV_GROUPS } from "@/components/layout/navConfig"
import { PAGE_VISIT_PATHS, daysAgoKey, localDateKey, prunePageVisits, summarizePageVisits } from "./pageVisits"
import { PageVisitStore } from "./pageVisitStore"
import { PAGE_VISIT_SENT_KEY, PageVisitTracker } from "./pageVisitTracker"

const NOW = new Date(2026, 9, 25, 12, 0, 0).getTime()
const TODAY = localDateKey(NOW)
const YESTERDAY = daysAgoKey(NOW, 1)

const cleanup: string[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

async function tempFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-page-visits-"))
  cleanup.push(dir)
  return path.join(dir, "config", "page-visits.json")
}

describe("[FS-7] 数えるページ", () => {
  it("サイドバーの項目と使い方ガイドの13ページと同じ", () => {
    const nav = [...NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)), HELP_ITEM.href]
    expect([...PAGE_VISIT_PATHS].sort()).toEqual(nav.sort())
    expect(PAGE_VISIT_PATHS).toHaveLength(13)
  })

  it("30日より古い日・表に無いパス・0回の日は残さない", () => {
    const old = daysAgoKey(NOW, 30)
    const edge = daysAgoKey(NOW, 29)
    expect(
      prunePageVisits({ "/": { [old]: 2, [edge]: 1, [TODAY]: 0 }, "/secret/x": { [TODAY]: 1 }, "/help": { bad: 1 } }, NOW)
    ).toEqual({ "/": { [edge]: 1 } })
  })

  it("表は13ページを30日の回数の多い順に並べ、7日・30日・最後に開いた日を出す", () => {
    const rows = summarizePageVisits({ "/help": { [TODAY]: 1, [daysAgoKey(NOW, 10)]: 2 }, "/": { [YESTERDAY]: 1 } }, NOW)
    expect(rows).toHaveLength(13)
    expect(rows[0]).toEqual({ path: "/help", last7: 1, last30: 3, lastDate: TODAY })
    expect(rows[1]).toEqual({ path: "/", last7: 1, last30: 1, lastDate: YESTERDAY })
    expect(rows[2]).toEqual({ path: "/desktop-sessions", last7: 0, last30: 0, lastDate: null })
  })
})

describe("[FS-7] サーバーの保存", () => {
  function makeStore(filePath: string, now = () => NOW) {
    const scheduled: Array<{ fn: () => void; ms: number }> = []
    const store = new PageVisitStore({ filePath: () => filePath, now, schedule: (fn, ms) => scheduled.push({ fn, ms }) })
    return { store, scheduled }
  }

  it("初期値はオン。13ページのパスと日付ごとの回数だけを書き、同じ日・同じパスはプロセスの中で1回", async () => {
    const file = await tempFile()
    const { store } = makeStore(file)
    expect(await store.get()).toEqual({ enabled: true, visits: {} })
    const accepted = await store.record({
      visits: [
        { path: "/", date: TODAY },
        { path: "/", date: TODAY },
        { path: "/help", date: YESTERDAY },
        { path: "/secret?x=1", date: TODAY },
        { path: "/rules", date: daysAgoKey(NOW, 2) },
        { path: "/rules", date: "2026/10/25" },
      ],
    })
    expect(accepted).toBe(2)
    await store.flush()
    const saved = JSON.parse(await fs.readFile(file, "utf-8"))
    expect(saved).toEqual({ enabled: true, visits: { "/": { [TODAY]: 1 }, "/help": { [YESTERDAY]: 1 } } })
    expect(Object.keys(saved)).toEqual(["enabled", "visits"])
  })

  it("ファイルへは1分に1回まで。間に届いた分はためて、1分たってからまとめて書く", async () => {
    const file = await tempFile()
    let now = NOW
    const { store, scheduled } = makeStore(file, () => now)
    await store.record({ visits: [{ path: "/", date: TODAY }] })
    await store.flush()
    now += 10_000
    await store.record({ visits: [{ path: "/help", date: TODAY }] })
    await store.record({ visits: [{ path: "/rules", date: TODAY }] })
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0].ms).toBe(50_000)
    // まだ書いていない分も、読むときは足して返す
    expect((await store.get()).visits).toEqual({ "/": { [TODAY]: 1 }, "/help": { [TODAY]: 1 }, "/rules": { [TODAY]: 1 } })
    expect(JSON.parse(await fs.readFile(file, "utf-8")).visits).toEqual({ "/": { [TODAY]: 1 } })
    now += 50_000
    scheduled[0].fn()
    await store.flush()
    expect(JSON.parse(await fs.readFile(file, "utf-8")).visits).toEqual({
      "/": { [TODAY]: 1 },
      "/help": { [TODAY]: 1 },
      "/rules": { [TODAY]: 1 },
    })
  })

  it("オフのあいだは数えない。数えた結果は消さない。オンに戻せる", async () => {
    const file = await tempFile()
    const { store } = makeStore(file)
    await store.record({ visits: [{ path: "/", date: TODAY }] })
    expect(await store.setEnabled({ enabled: false })).toEqual({ enabled: false, visits: { "/": { [TODAY]: 1 } } })
    expect(await store.record({ visits: [{ path: "/help", date: TODAY }] })).toBe(0)
    expect(await store.get()).toEqual({ enabled: false, visits: { "/": { [TODAY]: 1 } } })
    expect((await store.setEnabled({ enabled: true })).enabled).toBe(true)
  })

  it("形の違う入力は断る", async () => {
    const { store } = makeStore(await tempFile())
    await expect(store.record({})).rejects.toThrow("visits")
    await expect(store.record({ visits: Array.from({ length: 51 }, () => ({ path: "/", date: TODAY })) })).rejects.toThrow("50")
    await expect(store.setEnabled({ enabled: "no" })).rejects.toThrow("enabled")
  })

  it("壊れたファイルは、オン・回数なしとして読む", async () => {
    const file = await tempFile()
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, "{ broken", "utf-8")
    expect(await makeStore(file).store.get()).toEqual({ enabled: true, visits: {} })
  })
})

describe("[FS-7] 画面の記録", () => {
  function makeTracker(options: { storage?: Map<string, string> | null; fail?: boolean } = {}) {
    let now = NOW
    const sent: Array<Array<{ path: string; date: string }>> = []
    const scheduled: Array<{ fn: () => void; ms: number }> = []
    const map = options.storage === undefined ? new Map<string, string>() : options.storage
    let fail = options.fail ?? false
    const tracker = new PageVisitTracker({
      now: () => now,
      send: async (items) => {
        if (fail) throw new Error("offline")
        sent.push(items)
      },
      schedule: (fn, ms) => scheduled.push({ fn, ms }),
      storage: map && { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) },
    })
    return {
      tracker,
      sent,
      scheduled,
      map,
      advance: (ms: number) => (now += ms),
      setFail: (v: boolean) => (fail = v),
    }
  }

  it("同じ日・同じパスは1回だけ送る。表に無いパスは送らない", async () => {
    const t = makeTracker()
    t.tracker.visit("/")
    await t.tracker.flush()
    t.tracker.visit("/")
    t.tracker.visit("/projects/abc")
    expect(t.sent).toEqual([[{ path: "/", date: TODAY }]])
    expect(JSON.parse(t.map!.get(PAGE_VISIT_SENT_KEY)!)).toEqual({ date: TODAY, paths: ["/"] })
  })

  it("送るのは1分に1回まで。間に開いたページは、まとめて1回で送る", async () => {
    const t = makeTracker()
    t.tracker.visit("/")
    await Promise.resolve()
    t.advance(5_000)
    t.tracker.visit("/help")
    t.tracker.visit("/rules")
    expect(t.scheduled).toHaveLength(1)
    expect(t.scheduled[0].ms).toBe(55_000)
    t.advance(55_000)
    t.scheduled[0].fn()
    await t.tracker.flush()
    expect(t.sent).toEqual([
      [{ path: "/", date: TODAY }],
      [
        { path: "/help", date: TODAY },
        { path: "/rules", date: TODAY },
      ],
    ])
  })

  it("次の日は、また1回数える。送れなかった分は列に戻して次に送る", async () => {
    const t = makeTracker({ fail: true })
    t.tracker.visit("/")
    await t.tracker.flush()
    expect(t.sent).toEqual([])
    t.setFail(false)
    t.advance(60_000)
    await t.tracker.flush()
    expect(t.sent).toEqual([[{ path: "/", date: TODAY }]])
    t.advance(24 * 60 * 60_000)
    t.tracker.visit("/")
    await t.tracker.flush()
    expect(t.sent[1]).toEqual([{ path: "/", date: localDateKey(NOW + 24 * 60 * 60_000 + 60_000) }])
  })

  it("localStorage が使えないときも、メモリの印で同じ日の2回目は送らない", async () => {
    const t = makeTracker({ storage: null })
    t.tracker.visit("/help")
    await t.tracker.flush()
    t.advance(120_000)
    t.tracker.visit("/help")
    await t.tracker.flush()
    expect(t.sent).toHaveLength(1)
  })
})
