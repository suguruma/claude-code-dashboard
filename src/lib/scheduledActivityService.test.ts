process.env.TZ = "Asia/Tokyo"

import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FAKE_ACCOUNT, FAKE_ORG, SENTINEL, fakeCliId, fakeSessionId, fakeUuid, makeMeta, makeSessionSummary } from "./desktopFixtures"
import { DesktopSessionService } from "./desktopSessionService"
import { projectMeta } from "./desktopSessions"
import type { DesktopSessionMessaging } from "./desktopSessionTypes"
import { readJsonlFrom } from "./jsonlReader"
import { LAN_HEADER } from "./lanAccess/config"
import { compareRuns, dayKey } from "./scheduledActivity"
import { ScheduledActivityService } from "./scheduledActivityService"
import { buildMarks } from "./statusMark"
import { UsageLedger } from "./usageLedger"
import { PriceBook } from "./usagePricing"

const HOUR = 3600_000
const DAY = 24 * HOUR
const NOW = Date.parse("2026-11-10T12:00:00+09:00")
const cleanup: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const dir of cleanup.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})

let msg = 0
/** 応答1件の行(同じ message.id の行を2つ。使用量は同じ) */
function usageLines(at: number, model: string, o: { output?: number; cacheRead?: number; uuid?: string } = {}): string[] {
  const id = `msg_t_${++msg}`
  const line = (n: number) =>
    JSON.stringify({
      type: "assistant",
      uuid: n === 2 && o.uuid ? o.uuid : `u-${msg}-${n}`,
      timestamp: new Date(at).toISOString(),
      message: {
        id,
        model,
        role: "assistant",
        content: [{ type: "text", text: `本文 ${SENTINEL}` }],
        usage: { input_tokens: 10, output_tokens: o.output ?? 1000, cache_read_input_tokens: o.cacheRead ?? 100_000, cache_creation_input_tokens: 0 },
      },
    })
  return [line(1), line(2)]
}

interface Fixture {
  root: string
  dataDir: string
  sessionsDir: string
  projectsRoot: string
  projectDir: string
}

async function fixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-scheduled-test-"))
  cleanup.push(root)
  const dataDir = path.join(root, "data")
  const sessionsDir = path.join(dataDir, "claude-code-sessions", FAKE_ACCOUNT, FAKE_ORG)
  const projectsRoot = path.join(root, "projects")
  const projectDir = path.join(projectsRoot, "C--sample")
  await fs.mkdir(sessionsDir, { recursive: true })
  await fs.mkdir(projectDir, { recursive: true })
  return { root, dataDir, sessionsDir, projectsRoot, projectDir }
}

async function writeTranscript(file: string, lines: string[], mtime: number): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, lines.join("\n") + "\n", "utf-8")
  await fs.utimes(file, new Date(mtime), new Date(mtime))
}

async function writeMeta(fx: Fixture, meta: Record<string, unknown>): Promise<void> {
  await fs.writeFile(path.join(fx.sessionsDir, `${meta.sessionId as string}.json`), JSON.stringify(meta), "utf-8")
}

/**
 * 合成のデータ：
 * - n=1 予定タスク alpha・2日前・完了。本体 Opus・サブエージェント2本(種類 web-fetch と記録なし)
 * - n=2 予定タスク alpha・20日前(15日より前)。会話記録の更新時刻も20日前
 * - n=3 予定タスク beta・1日前・アーカイブ済みで要対応。前の会話記録(priorCliSessionIds)の分も持つ
 * - n=4 予定タスクでないセッション(会話記録は開かない)
 */
async function seed(fx: Fixture): Promise<void> {
  const t1 = NOW - 2 * DAY
  await writeMeta(fx, makeMeta({ n: 1, scheduledTaskId: "alpha", createdAt: t1, lastActivityAt: t1 + HOUR, isArchived: true, category: "completed" }))
  await writeTranscript(path.join(fx.projectDir, `${fakeCliId(1)}.jsonl`), [...usageLines(t1 + 60_000, "claude-opus-5-5"), ...usageLines(t1 + 120_000, "claude-opus-5-5")], t1 + HOUR)
  const subDir = path.join(fx.projectDir, fakeCliId(1), "subagents")
  await writeTranscript(path.join(subDir, "agent-a1.jsonl"), usageLines(t1 + 90_000, "claude-haiku-5-5"), t1 + HOUR)
  await fs.writeFile(path.join(subDir, "agent-a1.meta.json"), JSON.stringify({ agentType: "web-fetch", description: `任せた作業 ${SENTINEL}` }), "utf-8")
  await writeTranscript(path.join(subDir, "agent-a2.jsonl"), usageLines(t1 + 95_000, "claude-haiku-5-5"), t1 + HOUR)

  const t2 = NOW - 20 * DAY
  await writeMeta(fx, makeMeta({ n: 2, scheduledTaskId: "alpha", createdAt: t2, lastActivityAt: t2 + HOUR, isArchived: true, category: "completed" }))
  await writeTranscript(path.join(fx.projectDir, `${fakeCliId(2)}.jsonl`), usageLines(t2 + 60_000, "claude-opus-5-5"), t2 + HOUR)

  const t3 = NOW - DAY
  const meta3 = makeMeta({
    n: 3,
    scheduledTaskId: "beta",
    createdAt: t3,
    lastActivityAt: t3 + HOUR,
    isArchived: true,
    category: "blocked",
    summaryFor: fakeUuid(3),
    lastAssistantUuid: fakeUuid(3),
  })
  meta3.priorCliSessionIds = [fakeCliId(30), "../bad id"]
  await writeMeta(fx, meta3)
  await writeTranscript(path.join(fx.projectDir, `${fakeCliId(3)}.jsonl`), usageLines(t3 + 60_000, "claude-sonnet-5-5", { uuid: fakeUuid(3) }), t3 + HOUR)
  await writeTranscript(path.join(fx.projectDir, `${fakeCliId(30)}.jsonl`), usageLines(t3 + 30_000, "claude-sonnet-5-5", { output: 3000 }), t3 + HOUR)

  await writeMeta(fx, makeMeta({ n: 4, createdAt: NOW - HOUR, lastActivityAt: NOW - HOUR }))
  await writeTranscript(path.join(fx.projectDir, `${fakeCliId(4)}.jsonl`), usageLines(NOW - HOUR, "claude-opus-5-5"), NOW - HOUR)

  const defs = path.join(fx.root, "scheduled-tasks")
  for (const name of ["alpha", "beta", "unused", "bad name"]) {
    await fs.mkdir(path.join(defs, name), { recursive: true })
    await fs.writeFile(path.join(defs, name, "SKILL.md"), SENTINEL, "utf-8")
  }
}

function makeService(fx: Fixture) {
  const desktop = new DesktopSessionService({ dataDir: fx.dataDir, projectsRoot: fx.projectsRoot, now: () => NOW })
  const service = new ScheduledActivityService({
    projectsRoot: fx.projectsRoot,
    prices: new PriceBook(),
    runs: () => desktop.scheduledRuns(),
    now: () => NOW,
  })
  return { desktop, service }
}

describe("[AG-6] メタデータの予定タスクの項目", () => {
  it("予定タスクの名前と前の会話記録の ID を、形に合う物だけ取り込む。無いセッションの形は今までと同じ", () => {
    const meta = makeMeta({ n: 1, scheduledTaskId: "daily-task_1.x" })
    meta.priorCliSessionIds = [fakeCliId(9), "../x", 5]
    expect(projectMeta(meta)).toMatchObject({ scheduledTaskId: "daily-task_1.x", priorCliSessionIds: [fakeCliId(9)] })
    expect(projectMeta(makeMeta({ n: 2, scheduledTaskId: "../escape" }))?.scheduledTaskId).toBeUndefined()
    const plain = projectMeta(makeMeta({ n: 3 }))
    expect(plain && "scheduledTaskId" in plain).toBe(false)
    expect(plain && "priorCliSessionIds" in plain).toBe(false)
  })
})

describe("[AG-1][AG-5][AG-6] 予定タスクの集計", () => {
  it("[A1][A6] アーカイブ済みを含めて回を数え、20日前の回も読む。予定タスクでないセッションの記録は開かない", async () => {
    const fx = await fixture()
    await seed(fx)
    const { desktop } = makeService(fx)
    // 一覧(ほかのページと共有)の読み取りと分けるため、予定タスクの回は先に取っておいて渡す
    const snapshot = await desktop.scheduledRuns()
    await desktop.settle()
    const service = new ScheduledActivityService({ projectsRoot: fx.projectsRoot, prices: new PriceBook(), runs: async () => snapshot, now: () => NOW })
    const opened: string[] = []
    const open = fs.open.bind(fs)
    vi.spyOn(fs, "open").mockImplementation(((p: Parameters<typeof fs.open>[0], ...rest: unknown[]) => {
      opened.push(String(p))
      return (open as (...a: unknown[]) => ReturnType<typeof fs.open>)(p, ...rest)
    }) as typeof fs.open)

    const res = await service.get()
    expect(res.horizonDays).toBe(30)
    expect(res.runs.map((r) => r.taskId).sort()).toEqual(["alpha", "alpha", "beta"])
    const old = res.runs.find((r) => r.desktopId === fakeSessionId(2))
    expect(old).toMatchObject({ hasUsage: true, archived: true })
    expect(old?.cost).toBeGreaterThan(0)
    // 予定タスクの集計は、予定タスクでないセッションの会話記録を開かない
    expect(opened.some((p) => p.includes(fakeCliId(4)))).toBe(false)
    expect(opened.some((p) => p.includes(fakeCliId(1)))).toBe(true)
    // ［利用上限］の台帳(15日)では、20日前の回は入らない
    const usageLedger = new UsageLedger({ projectsRoot: fx.projectsRoot, now: () => NOW })
    await usageLedger.refresh()
    expect(usageLedger.rows().some((r) => r.sessionKey === fakeCliId(2))).toBe(false)
    expect(res.definitions).toEqual(["alpha", "beta", "unused"])
  })

  it("[A1] 状態の印は一覧の印と同じ。アーカイブ済みで要対応の回に止まった理由が付く", async () => {
    const fx = await fixture()
    await seed(fx)
    const { desktop, service } = makeService(fx)
    const res = await service.get()
    const list = await desktop.list()
    const marks = buildMarks(list.sessions, NOW)
    for (const r of res.runs) expect(r.mark).toEqual(marks.get(r.desktopId))
    const beta = res.runs.find((r) => r.taskId === "beta")
    expect(beta?.mark).toMatchObject({ symbol: "？", text: "判断", tone: "gray" })
    expect(beta?.stopReason).toBe("要対応")
    expect(res.runs.find((r) => r.desktopId === fakeSessionId(1))?.stopReason).toBeNull()
  })

  it("[A2][A5] モデル別のトークンは本体とサブエージェントを分けて、会話記録の合計と一致する。種類は agentType、無ければ「種類不明」", async () => {
    const fx = await fixture()
    await seed(fx)
    const { service } = makeService(fx)
    const res = await service.get()
    const r1 = res.runs.find((r) => r.desktopId === fakeSessionId(1))!
    // 本体：応答2件(同じ id の重複行は1件に数える)× (10+1000+100000)
    expect(r1.tokens).toEqual([
      { family: "Opus", subagent: false, tokens: 2 * 101_010 },
      { family: "Haiku", subagent: true, tokens: 2 * 101_010 },
    ])
    expect(r1).toMatchObject({ subagentCount: 2, subagentFamilies: ["Haiku"], mainFamilies: ["Opus"] })
    expect(r1.subagentTypes).toEqual({ "web-fetch": 1, 種類不明: 1 })
    expect(r1.mainCost).toBeLessThan(r1.cost)
  })

  it("[A6] 前の会話記録(priorCliSessionIds)の分を合計に含める", async () => {
    const fx = await fixture()
    await seed(fx)
    const { service } = makeService(fx)
    const beta = (await service.get()).runs.find((r) => r.taskId === "beta")!
    expect(beta.tokens).toEqual([{ family: "Sonnet", subagent: false, tokens: 101_010 + 103_010 }])
  })

  it("[A5][A7] 応答に本文・パス・題名・description・定義の中身が無い", async () => {
    const fx = await fixture()
    await seed(fx)
    const { service } = makeService(fx)
    const text = JSON.stringify(await service.get())
    expect(text).not.toContain(SENTINEL)
    expect(text).not.toContain("任せた作業")
    expect(text).not.toContain("description")
    expect(text).not.toContain(fx.root.replace(/\\/g, "\\\\"))
    expect(text).not.toContain("sample")
    expect(text).not.toContain("サンプルセッション")
    expect(text).not.toContain(fakeCliId(1))
  })

  it("[A1] アーカイブ済みで送信上限・届かない送信の回に、止まった理由が付く(アーカイブしていない回には付けない)", async () => {
    const messaging = (o: Partial<DesktopSessionMessaging>): DesktopSessionMessaging => ({ sent: 10, limit: 10, stopped: false, undelivered: 0, exact: true, ...o })
    const summaries = [
      makeSessionSummary("local_a", { isArchived: true, status: "waiting", messaging: messaging({ stopped: true }), createdAt: NOW - HOUR }),
      makeSessionSummary("local_b", { isArchived: true, status: "completed", messaging: messaging({ undelivered: 2 }), createdAt: NOW - HOUR }),
      makeSessionSummary("local_c", { isArchived: false, status: "blocked", createdAt: NOW - HOUR }),
    ]
    const service = new ScheduledActivityService({
      projectsRoot: null,
      prices: new PriceBook(),
      runs: async () => ({ sessions: summaries, runs: summaries.map((s) => ({ summary: s, taskId: "t", cliSessionIds: [] })) }),
      now: () => NOW,
    })
    const res = await service.get()
    const by = (id: string) => res.runs.find((r) => r.desktopId === id)
    expect(by("local_a")?.stopReason).toBe("送信上限")
    expect(by("local_b")?.stopReason).toBe("届かない送信")
    expect(by("local_c")?.stopReason).toBeNull()
    expect(res.runs.every((r) => !r.hasUsage)).toBe(true)
    expect(res.definitions).toEqual([])
  })

  it("[A13] 新しい系統が最後の回に初めて出て、その回が24時間より前なら選ばない(重さの順になる)", async () => {
    const fx = await fixture()
    await seed(fx)
    const { service } = makeService(fx)
    const res = await service.get()
    // alpha は20日前の回の後、2日前の回(最後の回)で Haiku を初めて使った。1回だけでは使い続けたか分からない
    expect(res.defaultSelection).toMatchObject({ reason: "weight", boundaryDay: null })
  })

  it("[A13] 同じ系統で版だけ違うモデルに替わっても、新しい系統と数えない(モデル ID からの通し)", async () => {
    const fx = await fixture()
    await seed(fx)
    // gamma：3日前は claude-opus-5-0、12時間前は claude-opus-5-5
    for (const [n, ago, model] of [[5, 3 * DAY, "claude-opus-5-0"], [6, 12 * HOUR, "claude-opus-5-5"]] as const) {
      const t = NOW - ago
      await writeMeta(fx, makeMeta({ n, scheduledTaskId: "gamma", createdAt: t, lastActivityAt: t + HOUR, isArchived: true, category: "completed" }))
      await writeTranscript(path.join(fx.projectDir, `${fakeCliId(n)}.jsonl`), usageLines(t + 60_000, model), t + HOUR)
    }
    // delta：3日前は Opus、12時間前に Sonnet を初めて使った(24時間以内なので選ばれる)
    for (const [n, ago, model] of [[7, 3 * DAY, "claude-opus-5-5"], [8, 12 * HOUR, "claude-sonnet-5-5"]] as const) {
      const t = NOW - ago
      await writeMeta(fx, makeMeta({ n, scheduledTaskId: "delta", createdAt: t, lastActivityAt: t + HOUR, isArchived: true, category: "completed" }))
      await writeTranscript(path.join(fx.projectDir, `${fakeCliId(n)}.jsonl`), usageLines(t + 60_000, model), t + HOUR)
    }
    const { service } = makeService(fx)
    const res = await service.get()
    expect(res.runs.filter((r) => r.taskId === "gamma").map((r) => r.mainFamilies)).toEqual([["Opus"], ["Opus"]])
    expect(res.defaultSelection).toEqual({ taskId: "delta", reason: "new-family", boundaryDay: "2026-11-10" })
  })

  it("[A11] 読む期間を15日に戻すと、前の7日の回が期間の外に出たとき「記録の外」で差を出さない", async () => {
    const fx = await fixture()
    await seed(fx)
    const desktop = new DesktopSessionService({ dataDir: fx.dataDir, projectsRoot: fx.projectsRoot, now: () => NOW })
    const service = new ScheduledActivityService({ projectsRoot: fx.projectsRoot, prices: new PriceBook(), runs: () => desktop.scheduledRuns(), now: () => NOW, horizonDays: 15 })
    const res = await service.get()
    expect(res.horizonDays).toBe(15)
    // 20日前の回は、使用量は読まないが、比べで「記録の外」と数えるために返す
    const old = res.runs.find((r) => r.desktopId === fakeSessionId(2))
    expect(old).toMatchObject({ hasUsage: false })
    const alpha = res.runs.filter((r) => r.taskId === "alpha")
    const c = compareRuns(alpha, dayKey(NOW - 16 * DAY), NOW, res.horizonStart)
    expect(c.before.outOfRecord).toBe(1)
    expect(c.diff).toBeNull()
    expect(c.blocked).toBe("out-of-record")
  })

  it("[A7] 集計の間に外部への通信が無い(fetch・http・https・net を呼ばない)", async () => {
    const fx = await fixture()
    await seed(fx)
    const http = (await import("http")).default
    const https = (await import("https")).default
    const net = (await import("net")).default
    const spies = [
      vi.spyOn(globalThis, "fetch"),
      vi.spyOn(http, "request"),
      vi.spyOn(https, "request"),
      vi.spyOn(net, "connect"),
      vi.spyOn(net, "createConnection"),
    ]
    const { service } = makeService(fx)
    await service.get()
    for (const s of spies) expect(s).not.toHaveBeenCalled()
  })
})

describe("[AG-7][A7] API", () => {
  it("LAN の入り口を通った要求は 403", async () => {
    const { GET } = await import("@/app/api/scheduled-activity/route")
    const res = await GET(new Request("http://127.0.0.1/api/scheduled-activity", { headers: { [LAN_HEADER]: "1" } }))
    expect(res.status).toBe(403)
  })
})

describe("[A11] 読み取りの速さ：使用量の文字列を含む行だけを文字にする", () => {
  it("needle を含む行だけを、行の区切りを保って渡す(行の途中・先頭・末尾・チャンクの境目)", async () => {
    const fx = await fixture()
    const file = path.join(fx.root, "x.jsonl")
    const lines = ['{"usage":1}', "x".repeat(5000), 'a"usage"b', "日本語の行", '{"k":"v","usage":{"n":2}}', ""]
    await fs.writeFile(file, lines.join("\n") + "\n" + 'partial "usage"', "utf-8")
    const size = (await fs.stat(file)).size
    for (const chunk of [64, 1024, 4 * 1024 * 1024]) {
      const got: string[] = []
      const all: string[] = []
      const end = await readJsonlFrom(file, 0, size, (l) => got.push(l), chunk, '"usage"')
      await readJsonlFrom(file, 0, size, (l) => all.push(l), chunk)
      expect(got).toEqual(all.filter((l) => l.includes('"usage"')))
      expect(got).toEqual(['{"usage":1}', 'a"usage"b', '{"k":"v","usage":{"n":2}}'])
      // 改行で終わらない最後の行は次回に回す(needle の有無で同じ位置)
      expect(end).toBe(size - Buffer.byteLength('partial "usage"'))
    }
  })
})
