import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ELAPSED_SHOW_MS,
  MARKS_DELAY_MS,
  OFFICIAL_WAIT_MS,
  ORG_FRAME_DEFAULT_HEIGHT,
  ORG_FRAME_MAX_HEIGHT,
  SLOW_NOTICE_MS,
  countsVisible,
  failureReason,
  marksView,
  orgFrameHeight,
  rememberOrgHeight,
  sectionPhase,
  type StageMark,
} from "./homeStartup"
import { abortInflight, fetchLatest, hasInflight } from "./latestFetch"
import { EARLY_FETCH_MAX_AGE_MS, EARLY_FETCH_URLS, earlyFetchScript, takeEarly, takeEarlyStart } from "./earlyFetch"
import { FlowService, flowShareKey } from "./flowService"
import type { DesktopSessionService } from "./desktopSessionService"
import { UsageService } from "./usageService"
import { warmUp } from "./startupWarmup"
import { ApiRequestError } from "./fetcher"

// next/link は、先読みの指定(prefetch)を記録するだけの部品に差し替える(アプリのルーターが無くても描けるように)
const linkProps: Array<Record<string, unknown>> = []
vi.mock("next/link", () => ({
  default: (props: Record<string, unknown> & { children?: ReactNode }) => {
    linkProps.push(props)
    return createElement("a", { href: String(props.href) }, props.children)
  },
  useLinkStatus: () => ({ pending: false }),
}))

const cleanup: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  linkProps.length = 0
  await Promise.all(cleanup.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("欄の状態（打ち切らない）", () => {
  const T0 = 1_000_000
  it("[ST-8] 答えがあれば ready。失敗は、サーバーの失敗・つながらなかったときだけ。時間では失敗にしない", () => {
    expect(sectionPhase({ hasData: true, failed: true, startedAt: T0, now: T0 + 999_999 })).toBe("ready")
    expect(sectionPhase({ hasData: false, failed: true, startedAt: T0, now: T0 })).toBe("failed")
    expect(sectionPhase({ hasData: false, failed: false, startedAt: T0, now: T0 + SLOW_NOTICE_MS - 1 })).toBe("loading")
    // 30秒を過ぎても、失敗にはせず「時間がかかっています」(slow)。40秒・10分でも同じ
    expect(sectionPhase({ hasData: false, failed: false, startedAt: T0, now: T0 + SLOW_NOTICE_MS })).toBe("slow")
    expect(sectionPhase({ hasData: false, failed: false, startedAt: T0, now: T0 + 40_000 })).toBe("slow")
    expect(sectionPhase({ hasData: false, failed: false, startedAt: T0, now: T0 + 600_000 })).toBe("slow")
  })

  it("[ST-8] 失敗の理由は、サーバーが答えた失敗と、つながらなかった失敗を分ける", () => {
    expect(failureReason(new ApiRequestError("x", 500))).toBe("サーバーがエラーを返しました")
    expect(failureReason(new TypeError("Failed to fetch"))).toBe("サーバーにつながりませんでした")
  })
})

describe("件数は公式値を最長1.5秒だけ待つ", () => {
  const LIST = 2_000_000
  it("[ST-7] 公式値が来た・失敗したら、すぐ出す。まだなら1.5秒まで待ち、越えたら件数だけ先に出す", () => {
    expect(countsVisible({ listReadyAt: null, usagePhase: "ready", now: LIST })).toBe(false)
    expect(countsVisible({ listReadyAt: LIST, usagePhase: "ready", now: LIST })).toBe(true)
    expect(countsVisible({ listReadyAt: LIST, usagePhase: "failed", now: LIST })).toBe(true)
    expect(countsVisible({ listReadyAt: LIST, usagePhase: "loading", now: LIST + OFFICIAL_WAIT_MS - 1 })).toBe(false)
    expect(countsVisible({ listReadyAt: LIST, usagePhase: "loading", now: LIST + OFFICIAL_WAIT_MS })).toBe(true)
  })

  it("[ST-7] 公式値の API を5秒遅らせても、件数は一覧の答えが届いてから2秒以内に出る", () => {
    // 100ミリ秒ごとに見て、最初に出る時刻を探す(公式値は5秒後まで来ない)
    let shownAt: number | null = null
    for (let t = 0; t <= 5_000; t += 100) {
      const usagePhase = t >= 5_000 ? "ready" : "loading"
      if (countsVisible({ listReadyAt: LIST, usagePhase, now: LIST + t })) {
        shownAt = t
        break
      }
    }
    expect(shownAt).not.toBeNull()
    expect(shownAt!).toBeLessThanOrEqual(2_000)
  })
})

describe("上のバーの段階の印", () => {
  const START = 3_000_000
  const marks = (counts: StageMark["phase"], usage: StageMark["phase"], org: StageMark["phase"]): StageMark[] => [
    { id: "counts", phase: counts },
    { id: "usage", phase: usage },
    { id: "org", phase: org },
  ]
  const base = { startedAt: START, firstLoadDone: false, failureDismissed: false }

  it("[ST-9] 1.5秒より前は出さない(速い PC では一度も出ない)。待っていれば出る。印は3つ", () => {
    expect(marksView({ ...base, marks: marks("loading", "loading", "loading"), now: START + MARKS_DELAY_MS - 1 }).visible).toBe(false)
    const v = marksView({ ...base, marks: marks("ready", "loading", "loading"), now: START + MARKS_DELAY_MS })
    expect(v).toMatchObject({ visible: true, done: 1, total: 3 })
  })

  it("[ST-9] そろったら消える。初めての読み込みの後(再取得のあいだ)は出さない", () => {
    expect(marksView({ ...base, marks: marks("ready", "ready", "ready"), now: START + 10_000 }).visible).toBe(false)
    expect(marksView({ ...base, firstLoadDone: true, marks: marks("ready", "loading", "ready"), now: START + 60_000 }).visible).toBe(false)
  })

  it("[ST-9] 失敗の印は、そろっていても・初めての読み込みの後でも残り、閉じると消える", () => {
    expect(marksView({ ...base, marks: marks("ready", "ready", "failed"), now: START + 500 }).visible).toBe(true)
    expect(marksView({ ...base, firstLoadDone: true, marks: marks("ready", "ready", "failed"), now: START + 500 }).visible).toBe(true)
    expect(marksView({ ...base, failureDismissed: true, marks: marks("ready", "ready", "failed"), now: START + 500 }).visible).toBe(false)
  })

  it("[ST-9] 秒の数は3秒たってから。秒は1か所(この値)だけで、そろったら出さない", () => {
    expect(marksView({ ...base, marks: marks("ready", "loading", "loading"), now: START + ELAPSED_SHOW_MS - 1 }).elapsedSeconds).toBeNull()
    expect(marksView({ ...base, marks: marks("ready", "loading", "loading"), now: START + 8_400 }).elapsedSeconds).toBe(8)
    expect(marksView({ ...base, marks: marks("ready", "ready", "failed"), now: START + 8_400 }).elapsedSeconds).toBeNull()
  })
})

describe("組織図の枠の高さ", () => {
  it("[ST-6] 覚えた高さ(グループ・範囲ごと)を使い、無い・壊れた値は決まった高さ。範囲の外は丸める", () => {
    expect(orgFrameHeight(null, "g1", 4)).toBe(ORG_FRAME_DEFAULT_HEIGHT)
    const saved = rememberOrgHeight({}, "g1", 4, 1234.4)
    expect(orgFrameHeight(saved, "g1", 4)).toBe(1234)
    expect(orgFrameHeight(saved, "g1", 24)).toBe(ORG_FRAME_DEFAULT_HEIGHT)
    expect(orgFrameHeight({ "g1|4": Number.NaN }, "g1", 4)).toBe(ORG_FRAME_DEFAULT_HEIGHT)
    expect(orgFrameHeight(rememberOrgHeight({}, "g1", 4, 99_999), "g1", 4)).toBe(ORG_FRAME_MAX_HEIGHT)
  })

  it("[ST-6] グループがまだ分からないときは、同じ範囲で最後に覚えた高さ(一覧の答えが来る前の枠)", () => {
    const saved = rememberOrgHeight(rememberOrgHeight(rememberOrgHeight({}, "g1", 4, 900), "g2", 24, 700), "g2", 4, 1594)
    expect(orgFrameHeight(saved, null, 4)).toBe(1594)
    expect(orgFrameHeight(saved, null, 24)).toBe(700)
    expect(orgFrameHeight(saved, "g1", 4)).toBe(900)
    expect(orgFrameHeight(saved, null, 168)).toBe(ORG_FRAME_DEFAULT_HEIGHT)
  })

  it("[ST-6] 覚えるのは数だけで、組は最大20", () => {
    let saved: Record<string, number> = {}
    for (let i = 0; i < 30; i++) saved = rememberOrgHeight(saved, `g${i}`, 4, 500 + i)
    expect(Object.keys(saved)).toHaveLength(20)
    expect(Object.values(saved).every((v) => typeof v === "number")).toBe(true)
  })
})

describe("画面の側の要求を1本に保つ取得", () => {
  /** 答えを手で返せる fetch の差し替え。止められたら AbortError で失敗する */
  function controllableFetch() {
    const calls: Array<{ url: string; resolve: (body: unknown) => void; signal: AbortSignal }> = []
    vi.stubGlobal("fetch", (url: string, init: { signal: AbortSignal }) => {
      return new Promise((resolve, reject) => {
        const call = {
          url,
          signal: init.signal,
          resolve: (body: unknown) => resolve({ ok: true, status: 200, json: async () => body }),
        }
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))
        calls.push(call)
      })
    })
    return calls
  }

  it("[ST-8] 出し直すと、待っていた要求は止まり、その答えには出し直した要求の答えが渡る(失敗にならない)", async () => {
    const calls = controllableFetch()
    const first = fetchLatest<{ n: number }>("k1", "/api/x?1")
    expect(hasInflight("k1")).toBe(true)
    expect(abortInflight("k1")).toBe(true)
    const second = fetchLatest<{ n: number }>("k1", "/api/x?2")
    expect(calls[0].signal.aborted).toBe(true)
    // 生きている要求は、出し直した1本だけ
    expect(calls.filter((c) => !c.signal.aborted)).toHaveLength(1)
    calls[1].resolve({ n: 2 })
    await expect(second).resolves.toEqual({ n: 2 })
    await expect(first).resolves.toEqual({ n: 2 })
    expect(hasInflight("k1")).toBe(false)
  })

  it("[ST-8] 待っている要求が無ければ、止めるものは無い。サーバーの失敗は、そのまま失敗として返す", async () => {
    expect(abortInflight("none")).toBe(false)
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 500, json: async () => ({ error: "x" }) }))
    await expect(fetchLatest("k2", "/api/y")).rejects.toMatchObject({ status: 500 })
  })
})

describe("組織図の計算の共有（サーバー）", () => {
  /** groupSources の呼び出しを数え、答えを手で返せる、一覧のサービスの差し替え */
  function fakeSessions() {
    const pending: Array<() => void> = []
    let calls = 0
    const sessions = {
      groupSources: async () => {
        calls++
        await new Promise<void>((r) => pending.push(r))
        return { group: null, sources: [], outsiders: [], sideChatCounts: new Map() }
      },
      orchestratorPrefix: () => "00_",
    } as unknown as DesktopSessionService
    return { sessions, calls: () => calls, release: () => pending.splice(0).forEach((r) => r()) }
  }

  it("[ST-8] ［もう一度読み込む］で要求が2本届いても、同じグループ・範囲の計算は1回だけ(since が違っても共有)", async () => {
    const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)
    let now = NOW
    const fake = fakeSessions()
    const flow = new FlowService(fake.sessions, { now: () => now })
    const a = flow.build("g1", NOW - 4 * 3_600_000)
    now += 2_000 // 2秒後に出し直した(画面は since = いま − 範囲 を送る)
    const b = flow.build("g1", now - 4 * 3_600_000)
    expect(fake.calls()).toBe(1)
    // 違うグループ・範囲は別に計算する
    const c = flow.build("g2", now - 4 * 3_600_000)
    const d = flow.build("g1", now - 3_600_000)
    expect(fake.calls()).toBe(3)
    // groupSources はマイクロタスクで呼ばれるので、待ってから返す
    await new Promise((r) => setTimeout(r, 0))
    fake.release()
    await Promise.all([a, b, c, d])
    // 終わった後の要求は、新しく計算する
    const e = flow.build("g1", now - 4 * 3_600_000)
    expect(fake.calls()).toBe(4)
    await new Promise((r) => setTimeout(r, 0))
    fake.release()
    await e
  })

  it("[ST-8] 共有のキーは（グループ・範囲）で、since そのものは含めない", () => {
    const NOW = 5_000_000_000
    expect(flowShareKey("g1", NOW - 4 * 3_600_000, NOW)).toBe(flowShareKey("g1", NOW + 2_000 - 4 * 3_600_000, NOW + 2_000))
    expect(flowShareKey("g1", NOW - 4 * 3_600_000, NOW)).not.toBe(flowShareKey("g1", NOW - 3_600_000, NOW))
  })
})

describe("利用上限の公式値だけの軽い答え", () => {
  it("[ST-7] 会話記録を読まずに、公式値の記録だけで窓と上限ガードを返す(推定・セッション別の消費は空)", async () => {
    const NOW = Date.UTC(2026, 9, 18, 12, 0, 0)
    const HOUR = 3_600_000
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-usage-official-"))
    cleanup.push(root)
    const snapshotsPath = path.join(root, "usage-snapshots.jsonl")
    await fs.writeFile(
      snapshotsPath,
      JSON.stringify({
        ts: new Date(NOW - HOUR).toISOString(),
        source: "get_usage",
        recordedBy: "SENTINEL-RECORDER",
        plan: "Pro",
        windows: [
          { key: "five_hour", label: "5-hour limit", percentUsed: 92, resetsAt: new Date(NOW + 2 * HOUR).toISOString() },
          { key: "weekly_all", label: "Weekly · all models", percentUsed: 14, resetsAt: new Date(NOW + 5 * 24 * HOUR).toISOString() },
        ],
      }) + "\n"
    )
    // 会話記録のルートは存在しない場所(読めば空になるだけだが、読まないことを確かめる)
    const service = new UsageService({ projectsRoot: path.join(root, "missing"), snapshotsPath, now: () => NOW })
    const res = await service.getOfficial()
    expect(res.phase).toBe("official")
    const five = res.windows.find((w) => w.key === "five_hour")!
    expect(five.displayPercent).toBe(92)
    expect(five.estimate.kind).toBe("none")
    expect(res.guard.level).toBe("high")
    expect(res.contributions.fiveHour.items).toHaveLength(0)
    expect(JSON.stringify(res)).not.toContain("SENTINEL-RECORDER")
  })
})

describe("サーバー側の暖機", () => {
  it("[ST-10] 一覧と利用上限の台帳を両方読み始め、失敗しても投げない", async () => {
    const order: string[] = []
    const ok = await warmUp({
      list: async () => order.push("list"),
      usage: async () => order.push("usage"),
    })
    expect(ok).toEqual({ list: true, usage: true })
    expect(order.sort()).toEqual(["list", "usage"])
    const failed = await warmUp({
      list: async () => {
        throw new Error("x")
      },
      usage: async () => 1,
    })
    expect(failed).toEqual({ list: false, usage: true })
  })
})

describe("ホームの部品", () => {
  it("[ST-4] サイドバーのリンクは、画面に入っただけでは先読みしない(prefetch=false。ポインタ・フォーカスで切り替える)", async () => {
    const { HoverPrefetchLink } = await import("@/components/layout/HoverPrefetchLink")
    renderToStaticMarkup(createElement(HoverPrefetchLink, { href: "/desktop-sessions" }, "セッション一覧"))
    expect(linkProps.at(-1)?.prefetch).toBe(false)
    expect(typeof linkProps.at(-1)?.onMouseEnter).toBe("function")
    expect(typeof linkProps.at(-1)?.onFocus).toBe("function")
    const sideNav = await fs.readFile(path.join(process.cwd(), "src", "components", "layout", "SideNav.tsx"), "utf-8")
    expect(sideNav).not.toMatch(/from "next\/link"/)
  })

  it("[ST-5] 読み込み中の件数・利用上限のカードに「—」「公式値なし」を出さない。答えが来て無いときだけ「—」", async () => {
    const { HomeSummaryCards } = await import("@/components/home/HomeSummaryCards")
    const loading = renderToStaticMarkup(
      createElement(HomeSummaryCards, { sessions: null, usage: null, countsPhase: "loading", usagePhase: "loading", onRetryUsage: async () => {} })
    )
    expect(loading).not.toContain("—")
    expect(loading).not.toContain("公式値なし")
    expect(loading).toContain("読み込んでいます")
    const none = renderToStaticMarkup(createElement(HomeSummaryCards, { sessions: null, usage: null }))
    expect(none).toContain("—")
  })

  it("[ST-5, ST-7] 公式値が失敗したら、件数は出し、利用上限のカードは「取得できません」と［もう一度読み込む］", async () => {
    const { HomeSummaryCards } = await import("@/components/home/HomeSummaryCards")
    const html = renderToStaticMarkup(
      createElement(HomeSummaryCards, { sessions: [], usage: null, countsPhase: "ready", usagePhase: "failed", onRetryUsage: async () => {} })
    )
    expect(html).toContain("0件")
    expect(html).toContain("取得できません")
    expect(html).toContain("もう一度読み込む")
  })

  it("[ST-9] role=\"status\" に入れる文は案内だけで、秒ごとに変わる数を含まない", async () => {
    const { RetryNotice } = await import("@/components/home/HomeLoading")
    const html = renderToStaticMarkup(
      createElement(RetryNotice, { phase: "slow", text: "時間がかかっています（30秒以上）。このまま待てます。", onRetry: async () => {} })
    )
    const status = /<span role="status"[^>]*>([^<]*)<\/span>/.exec(html)?.[1] ?? ""
    expect(status).toContain("30秒以上")
    expect(status.replace("30秒以上", "")).not.toMatch(/\d+秒/)
  })
})

describe("起動の見張り（exe）", () => {
  it("[ST-13] 「まだ準備中です」の見張りは、段階の時計の直後に始め、スプラッシュを作る前に置く", async () => {
    const main = await fs.readFile(path.join(process.cwd(), "electron", "main.js"), "utf-8")
    const body = main.slice(main.indexOf("async function createWindow()"))
    const clockAt = body.indexOf("createStageClock()")
    const armAt = body.indexOf("armWatchdog()\n") >= 0 ? body.indexOf("armWatchdog()\n") : body.indexOf("armWatchdog()\r\n")
    const splashAt = body.indexOf("createSplashWindow()")
    expect(clockAt).toBeGreaterThan(0)
    expect(armAt).toBeGreaterThan(clockAt)
    expect(armAt).toBeLessThan(splashAt)
  })

  it("[ST-13] スプラッシュの秒は1か所(eta)だけ。「まだ準備中です」の文には秒を入れない。［やめる］は20秒を過ぎたら小さく出す", async () => {
    const splash = await fs.readFile(path.join(process.cwd(), "electron", "splash.html"), "utf-8")
    expect(splash).toContain('slowTextEl.textContent = "まだ準備中です"')
    expect(splash).not.toMatch(/まだ準備中です（\$\{/)
    expect(splash).toContain("EARLY_QUIT_AFTER_SECONDS = 20")
  })
})

describe("portable の展開中の画像", () => {
  it("[ST-14] electron-builder の portable に、展開中の画像(24ビットの BMP)を指定し、その画像がある", async () => {
    const yml = await fs.readFile(path.join(process.cwd(), "electron-builder.yml"), "utf-8")
    const file = /splashImage:\s*(\S+)/.exec(yml)?.[1]
    expect(file).toBe("electron/portable-splash.bmp")
    const bmp = await fs.readFile(path.join(process.cwd(), file!))
    expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM")
    expect(bmp.readUInt16LE(28)).toBe(24)
  })
})

describe("早めの取得（静的な HTML のスクリプト）", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("[ST-7] スクリプトは同じオリジンの決まった API だけを取り、外のファイルを読まない", () => {
    const script = earlyFetchScript()
    for (const url of EARLY_FETCH_URLS) expect(script).toContain(JSON.stringify(url).slice(1, -1))
    expect(script).not.toMatch(/https?:|\/\/[a-z]/i)
    expect(script).not.toMatch(/<\/?script/i)
  })

  it("[ST-7] 早めの答えは1回だけ使う。古い(15秒より前)ときと、無いときは使わない", () => {
    const at = 1_000_000
    const answer = Promise.resolve({ ok: true, status: 200, body: { n: 1 } })
    vi.stubGlobal("window", { __ccdEarly: { at, requests: { "/api/desktop-sessions": answer, "/api/usage": answer } } })
    expect(takeEarly("/api/desktop-sessions", at + 1_000)).toBe(answer)
    expect(takeEarly("/api/desktop-sessions", at + 1_000)).toBeNull()
    expect(takeEarly("/api/usage", at + EARLY_FETCH_MAX_AGE_MS + 1)).toBeNull()
    expect(takeEarly("/api/flow", at)).toBeNull()
  })

  it("[ST-9] 最初に読んだホームの始まりは、HTML を読んだ時刻(1回だけ)。画面の内での移動・古いときは使わない", () => {
    const at = 2_000_000
    vi.stubGlobal("window", { __ccdEarly: { at, requests: {} } })
    expect(takeEarlyStart(at + 9_000)).toBe(at)
    expect(takeEarlyStart(at + 9_000)).toBeNull()
    vi.stubGlobal("window", { __ccdEarly: { at, requests: {} } })
    expect(takeEarlyStart(at + EARLY_FETCH_MAX_AGE_MS + 1)).toBeNull()
    vi.stubGlobal("window", {})
    expect(takeEarlyStart(at)).toBeNull()
  })

  it("[ST-7] 最初の取得は早めの答えを使い、失敗の答えのときは取り直す", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ from: "fetch" }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("window", {
      __ccdEarly: {
        at: Date.now(),
        requests: {
          "/api/desktop-sessions": Promise.resolve({ ok: true, status: 200, body: { from: "early" } }),
          "/api/usage": Promise.resolve({ ok: false, status: 500 }),
        },
      },
    })
    await expect(fetchLatest("early-list", "/api/desktop-sessions")).resolves.toEqual({ from: "early" })
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(fetchLatest("early-usage", "/api/usage")).resolves.toEqual({ from: "fetch" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
