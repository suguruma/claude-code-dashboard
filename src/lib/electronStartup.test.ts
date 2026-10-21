import http from "http"
import net from "net"
import { createRequire } from "module"
import { afterEach, describe, expect, it } from "vitest"
import { GET as healthGET } from "@/app/api/health/route"

// electron/startup.js はElectronのmainプロセス(CommonJS)が読むファイルなので、Nodeのrequireでそのまま読む
const startup = createRequire(import.meta.url)("../../electron/startup.js") as {
  HEALTH_PATH: string
  MIN_WAIT_BUDGET_MS: number
  MAX_WAIT_BUDGET_MS: number
  waitBudgetMs: (last: unknown) => number
  waitForServer: (
    port: number,
    options?: { path?: string; attemptTimeoutMs?: number; retryDelayMs?: number; stopReason?: () => string | null; onAttempt?: () => void }
  ) => Promise<void>
  createStageClock: (now?: () => number) => { mark: (s: string) => void; elapsed: () => number; snapshot: () => Record<string, number> }
  buildStartupStats: (input: {
    previous?: Record<string, unknown>
    outcome: "ok" | "quit" | "error"
    totalMs: number
    stages: Record<string, number>
    waitPrompts: number
    recordedAt: string
  }) => Record<string, unknown>
}

const servers: net.Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))))
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 要求のパスを数え、handler で答える小さなサーバー。ポートと、パスごとの数を返す */
async function fakeServer(handler: (path: string, res: http.ServerResponse) => void | Promise<void>, port = 0) {
  const counts: Record<string, number> = {}
  const server = http.createServer(async (req, res) => {
    const p = req.url ?? ""
    counts[p] = (counts[p] ?? 0) + 1
    await handler(p, res)
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()))
  return { port: (server.address() as net.AddressInfo).port, counts }
}

/** 今は空いているポート(まだ誰も待ち受けていない) */
async function freePort(): Promise<number> {
  const s = net.createServer()
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", () => resolve()))
  const port = (s.address() as net.AddressInfo).port
  await new Promise<void>((resolve) => s.close(() => resolve()))
  return port
}

describe("[ST-2] exe の起動の待ちの目安（waitBudgetMs）", () => {
  it.each([
    ["記録なし", undefined, 60_000],
    ["壊れた値", "abc", 60_000],
    ["0以下", -5, 60_000],
    ["速い PC（前回10秒）は下限の60秒", 10_000, 60_000],
    ["前回30秒なら3倍の90秒", 30_000, 90_000],
    ["前回50秒なら150秒", 50_000, 150_000],
    ["とても遅くても上限の10分", 400_000, 600_000],
  ])("%s", (_name, last, expected) => {
    expect(startup.waitBudgetMs(last)).toBe(expected)
  })
})

describe("サーバーの立ち上がりの確かめ（waitForServer）", () => {
  it("[ST-1] 軽い入り口(/api/health)だけを確かめ、重いトップページ(/)は1回も描かせない", async () => {
    const { port, counts } = await fakeServer(async (p, res) => {
      if (p === "/") await sleep(1500) // 重い描画(1回ごとの打ち切りより遅い)
      res.end("ok")
    })
    await startup.waitForServer(port)
    expect(startup.HEALTH_PATH).toBe("/api/health")
    expect(counts["/api/health"]).toBe(1)
    expect(counts["/"]).toBeUndefined()
  })

  it("[ST-2] 締め切りは無い：サーバーが遅れて待ち受けを始めても、待ち続けて準備できたら進む", async () => {
    const port = await freePort()
    let attempts = 0
    const waiting = startup.waitForServer(port, { retryDelayMs: 50, onAttempt: () => (attempts += 1) })
    await sleep(800) // この間はつながらない(遅い PC のサーバーの立ち上がり)
    await fakeServer((_p, res) => {
      res.end("ok")
    }, port)
    await waiting
    expect(attempts).toBeGreaterThan(3)
  })

  it("[ST-1, ST-2] 答えが遅いあいだは、1回ごとに打ち切ってやり直し、速くなったら進む（打ち切りで失敗にしない）", async () => {
    let slow = true
    const { port, counts } = await fakeServer(async (_p, res) => {
      if (slow) await sleep(400)
      res.end("ok")
    })
    setTimeout(() => (slow = false), 700)
    await startup.waitForServer(port, { attemptTimeoutMs: 150, retryDelayMs: 50 })
    expect(counts["/api/health"]).toBeGreaterThan(1)
  })

  it("[ST-1] 2xx でない答え（404 など）は、まだ準備ができていないとみなす", async () => {
    let ready = false
    const { port } = await fakeServer((_p, res) => {
      res.statusCode = ready ? 200 : 404
      res.end()
    })
    setTimeout(() => (ready = true), 300)
    const started = Date.now()
    await startup.waitForServer(port, { retryDelayMs: 50 })
    expect(Date.now() - started).toBeGreaterThanOrEqual(250)
  })

  it("[ST-2] サーバーのプロセスが終わった・利用者がやめたときは、その理由ですぐ止まる", async () => {
    const port = await freePort()
    let reason: string | null = null
    setTimeout(() => (reason = "サーバーが終了しました（終了コード 1）"), 200)
    await expect(startup.waitForServer(port, { retryDelayMs: 50, stopReason: () => reason })).rejects.toThrow(
      "サーバーが終了しました（終了コード 1）"
    )
  })
})

describe("[ST-1] 立ち上がりの確かめの入り口（/api/health）", () => {
  it("データを読まずに、すぐ 200 と { ok: true } を返す（キャッシュさせない）", async () => {
    const res = healthGET()
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe("[ST-3] 段階ごとの時間と、startup-stats.json の中身", () => {
  it("段階は最初の1回だけ記録し、知らない段階は記録しない", () => {
    let t = 1000
    const clock = startup.createStageClock(() => t)
    t = 1100
    clock.mark("seed")
    t = 1500
    clock.mark("spawn")
    t = 1600
    clock.mark("seed")
    clock.mark("unknown-stage")
    t = 9000
    clock.mark("http-ok")
    expect(clock.snapshot()).toEqual({ seed: 100, spawn: 500, "http-ok": 8000 })
    expect(clock.elapsed()).toBe(8000)
  })

  it("起動を終えたときだけ前回の時間を新しくし、やめた・失敗したときは前回の値を残す。書くのは時間と結果と回数だけ", () => {
    const stages = { seed: 10, spawn: 40, "next-ready": 21000, "http-ok": 22000, "page-loaded": 35000, extra: 1 }
    const ok = startup.buildStartupStats({ previous: { lastDurationMs: 12000 }, outcome: "ok", totalMs: 35000, stages, waitPrompts: 0, recordedAt: "2026-10-21T00:00:00.000Z" })
    expect(ok).toEqual({
      lastDurationMs: 35000,
      lastOutcome: "ok",
      lastTotalMs: 35000,
      lastStages: { seed: 10, spawn: 40, "next-ready": 21000, "http-ok": 22000, "page-loaded": 35000 },
      lastWaitPrompts: 0,
      recordedAt: "2026-10-21T00:00:00.000Z",
    })
    const quit = startup.buildStartupStats({ previous: { lastDurationMs: 12000 }, outcome: "quit", totalMs: 70000, stages: { seed: 10 }, waitPrompts: 1, recordedAt: "x" })
    expect(quit.lastDurationMs).toBe(12000)
    expect(quit.lastOutcome).toBe("quit")
    expect(quit.lastWaitPrompts).toBe(1)
    // 前回の記録も無く、やめたとき：目安の元の値は書かない(次は下限の60秒になる)
    const first = startup.buildStartupStats({ outcome: "error", totalMs: 5000, stages: {}, waitPrompts: 0, recordedAt: "x" })
    expect("lastDurationMs" in first).toBe(false)
    // パスらしい文字列は入らない
    expect(JSON.stringify(ok)).not.toMatch(/[A-Za-z]:\\|\/Users\/|\\\\/)
  })
})
