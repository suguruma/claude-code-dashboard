import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { afterEach, describe, expect, it } from "vitest"
import { DesktopSessionService } from "./desktopSessionService"
import { FlowService } from "./flowService"
import { HousekeepingService, type HousekeepingUsageSource } from "./housekeepingService"
import { PriceBook } from "./usagePricing"
import type { UsageCalibration, UsageResponse } from "./usageTypes"

interface SampleModule {
  makeOrgChartSample: (
    outDir: string,
    options?: { now?: number }
  ) => {
    dataDir: string
    projectsRoot: string
    write: () => Promise<void>
    groups: { a: string; b: string }
    ids: Record<string, string>
    expected: Record<string, Record<string, unknown>>
  }
}

const cleanup: string[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

const FIVE_HOUR: UsageCalibration = { costPerPercentLow: 0.4, costPerPercentHigh: 0.5, mode: "intersect", samples: 3 }
const WEEKLY: UsageCalibration = { costPerPercentLow: 3, costPerPercentHigh: 3.6, mode: "intersect", samples: 3 }

function fakeUsage(calibrations: { fiveHour: UsageCalibration | null; weekly: UsageCalibration | null }): HousekeepingUsageSource {
  const book = new PriceBook()
  const windows = [
    { key: "five_hour", modelName: null, calibration: calibrations.fiveHour },
    { key: "weekly_all", modelName: null, calibration: calibrations.weekly },
    // モデル別の窓の較正は使わない
    { key: "weekly_model", modelName: "合成", calibration: { costPerPercentLow: 1, costPerPercentHigh: 1, mode: "single", samples: 1 } },
  ]
  return { get: async () => ({ windows }) as unknown as UsageResponse, priceOf: (model) => book.resolve(model) }
}

type SessionOptions = ConstructorParameters<typeof DesktopSessionService>[0]

/** 確認用の合成データ(scripts/make-org-chart-sample.mjs)を作り、整理ページのサービスを組み立てる */
async function sampleService(options: { usage?: HousekeepingUsageSource | null; sessions?: SessionOptions } = {}) {
  const mod = (await import(/* @vite-ignore */ pathToFileURL(path.join(process.cwd(), "scripts", "make-org-chart-sample.mjs")).href)) as SampleModule
  const now = Date.now()
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-housekeeping-test-"))
  cleanup.push(out)
  const sample = mod.makeOrgChartSample(path.join(out, "sample"), { now })
  await sample.write()
  const sessions = new DesktopSessionService({
    dataDir: sample.dataDir,
    projectsRoot: sample.projectsRoot,
    now: () => now,
    ...options.sessions,
  })
  const flow = new FlowService(sessions, { now: () => now })
  const usage = options.usage === undefined ? fakeUsage({ fiveHour: FIVE_HOUR, weekly: WEEKLY }) : options.usage
  const service = new HousekeepingService(sessions, flow, { now: () => now, usage: async () => usage })
  return { sample, now, service, sessions }
}

const KEYS_ALLOWED = new Set([
  // 応答の入れ物
  "generatedAt", "counts", "cleanup", "unanswered", "decisions", "warnings", "note",
  "items", "highContextRatio", "idleMinutes", "minIdleTokens", "calibrated", "fiveHour", "weekly", "thresholdMinutes", "rangeHours",
  // コンテキスト整理の候補
  "id", "title", "groupName", "model", "contextTokens", "contextRatio", "lastAssistantAt", "idleMs", "reasons", "cache", "resumeCost", "suggestClear",
  "usd", "priceUnregistered", "min", "max",
  // 返事の無い指示
  "kind", "groupId", "fromId", "fromTitle", "toId", "toTitle", "summary", "sentAt", "ageMs", "working",
  // 判断待ち
  "excerpt", "undeliveredCount", "lastActivityAt",
  // 判断待ち: 要対応の種類と手がかりの名前(⑩。文は含まない)
  "needsAction", "source", "estimated", "buttons",
])

function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, into))
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      into.add(k)
      allKeys(v, into)
    }
  }
  return into
}

describe("HousekeepingService: 合成データ", () => {
  it("3つの節の件数・並び・理由が、合成データの期待値と一致する", async () => {
    const { service, sample } = await sampleService()
    const res = await service.get()
    const exp = sample.expected.housekeeping as {
      cleanup: [string, string[], string][]
      unanswered: [string, string, string, boolean][]
      decisions: [string, string[]][]
    }

    expect(res.cleanup.items.map((i) => [i.id, i.reasons, i.cache])).toEqual(exp.cleanup)
    expect(res.unanswered.items.map((i) => [i.kind, i.fromId, i.toId, i.working])).toEqual(exp.unanswered)
    expect(res.decisions.items.map((i) => [i.id, i.reasons])).toEqual(exp.decisions)
    // 概要の件数は、一覧の行数と一致する
    expect(res.counts).toEqual({ cleanup: exp.cleanup.length, unanswered: exp.unanswered.length, decisions: exp.decisions.length })
    expect(res.warnings).toEqual([])
  })

  it("コンテキスト整理: 実行中・アーカイブ済み・小さいセッションは出ない。キャッシュが有効なものは後ろで、コストは null", async () => {
    const { service, sample } = await sampleService()
    const res = await service.get()
    const ids = new Set(res.cleanup.items.map((i) => i.id))
    expect(ids.has(sample.ids.screen)).toBe(false) // 実行中
    expect(ids.has(sample.ids.archived)).toBe(false) // アーカイブ済み
    expect(ids.has(sample.ids.leaderA)).toBe(false) // 30分前に応答があり、大きくもない
    expect(ids.has(sample.ids.practiceD)).toBe(false) // 実行中

    const docs = res.cleanup.items.find((i) => i.id === sample.ids.docs)
    expect(docs).toMatchObject({ cache: "valid", resumeCost: null, suggestClear: false })
    expect(res.cleanup.items[res.cleanup.items.length - 1].id).toBe(sample.ids.docs)

    const verify = res.cleanup.items[0]
    expect(verify.id).toBe(sample.ids.verify)
    // 906,000 トークン × opus の入力単価 4 × 2 ÷ 100万
    expect(verify.resumeCost?.usd).toBeCloseTo(7.248, 3)
    expect(verify.resumeCost).toMatchObject({ priceUnregistered: false })
    expect(verify.suggestClear).toBe(true)
    expect(verify.idleMs).toBeGreaterThanOrEqual(110 * 60_000)
    // コストの大きい順
    const costs = res.cleanup.items.flatMap((i) => (i.resumeCost ? [i.resumeCost.usd] : []))
    expect(costs).toEqual([...costs].sort((a, b) => b - a))
  })

  it("再開コストの割合: 5時間の枠・週の枠の較正から、金額÷(1%あたりの金額) の幅で出す", async () => {
    const { service, sample } = await sampleService()
    const verify = (await service.get()).cleanup.items.find((i) => i.id === sample.ids.verify)
    // 7.248 ÷ 0.5〜0.4（5時間）、7.248 ÷ 3.6〜3（週）
    expect(verify?.resumeCost?.fiveHour?.min).toBeCloseTo(14.496, 2)
    expect(verify?.resumeCost?.fiveHour?.max).toBeCloseTo(18.12, 2)
    expect(verify?.resumeCost?.weekly?.min).toBeCloseTo(2.0133, 3)
    expect(verify?.resumeCost?.weekly?.max).toBeCloseTo(2.416, 3)
  })

  it("較正が無い枠は割合を出さない（金額だけ）。利用上限のサービスが無くても動く", async () => {
    const onlyWeekly = await sampleService({ usage: fakeUsage({ fiveHour: null, weekly: WEEKLY }) })
    const a = await onlyWeekly.service.get()
    expect(a.cleanup.calibrated).toEqual({ fiveHour: false, weekly: true })
    expect(a.cleanup.items[0].resumeCost).toMatchObject({ fiveHour: null })
    expect(a.cleanup.items[0].resumeCost?.weekly).not.toBeNull()

    const none = await sampleService({ usage: null })
    const b = await none.service.get()
    expect(b.cleanup.calibrated).toEqual({ fiveHour: false, weekly: false })
    expect(b.cleanup.items[0].resumeCost).toMatchObject({ fiveHour: null, weekly: null })
    expect(b.cleanup.items[0].resumeCost?.usd).toBeCloseTo(7.248, 3) // 既定の価格表で金額だけ
    expect(b.warnings).toEqual([])
  })

  it("利用上限の取得に失敗しても、金額だけで返し、お知らせを出す（エラーの内容は出さない）", async () => {
    const failing: HousekeepingUsageSource = { get: async () => Promise.reject(new Error("読めない")), priceOf: () => new PriceBook().resolve("") }
    const { service } = await sampleService({ usage: failing })
    const res = await service.get()
    expect(res.cleanup.items.length).toBeGreaterThan(0)
    expect(res.cleanup.items[0].resumeCost?.fiveHour).toBeNull()
    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).not.toContain("読めない")
  })

  it("返事の無い指示: 種類・古い順・作業中。後から報告が付いた指示は出ない", async () => {
    const { service, sample } = await sampleService()
    const res = await service.get()
    const items = res.unanswered.items
    expect(items.map((i) => i.sentAt)).toEqual([...items.map((i) => i.sentAt)].sort((a, b) => a - b))
    // 報告が付いた指示（画面の修正の子への3件・3層目・別グループの調査の子）は、出ない
    expect(items.filter((i) => i.toId === sample.ids.screen)).toHaveLength(1)
    expect(items.some((i) => i.toId === sample.ids.helperB || i.toId === sample.ids.research)).toBe(false)
    const waiting = items.find((i) => i.kind === "awaiting-report")
    expect(waiting).toMatchObject({ fromTitle: "00_リーダー_試験", toTitle: "01_画面の修正", groupName: "試験グループ", working: true })
    expect(waiting?.ageMs).toBeGreaterThanOrEqual(59 * 60_000)
    expect(items.find((i) => i.kind === "possibly-undelivered")?.working).toBe(false)
  })

  it("返事の無い指示: しきい値を長くすると、報告待ち・未達の疑いは消えるが、報告なしで終了は残る", async () => {
    const { service } = await sampleService({ sessions: { housekeeping: { unansweredMs: 6 * 60 * 60_000 } } })
    const res = await service.get()
    expect(res.unanswered.items.map((i) => i.kind)).toEqual(["ended-without-report", "ended-without-report"])
    expect(res.unanswered.thresholdMinutes).toBe(360)
  })

  it("判断待ち: 要対応の内容は先頭60文字。グループ外のセッションも出る。停止中のものは1行にまとまる", async () => {
    const { service, sample } = await sampleService()
    const res = await service.get()
    const blocked = res.decisions.items.find((i) => i.id === sample.ids.blockedSummary)
    expect(blocked?.excerpt).toBe("本番への反映を承認してください（合成のデータ）")
    expect(blocked?.groupName).toBeNull()
    // 質問の回答待ちは、Desktopの要約文ではないので、内容は出さない
    expect(res.decisions.items.find((i) => i.id === sample.ids.askUser)?.excerpt).toBeNull()
    // 送信上限で停止中の検証の子は、undelivered を重ねず send-limit の1つだけ
    expect(res.decisions.items.find((i) => i.id === sample.ids.verify)?.reasons).toEqual(["send-limit"])
    expect(res.decisions.items.find((i) => i.id === sample.ids.unreachable)).toMatchObject({ reasons: ["undelivered"], undeliveredCount: 1 })
  })

  it("応答には、許可リストの項目だけがある。作業フォルダ・会話の本文・指示の21文字目以降は含まれない", async () => {
    const { service } = await sampleService()
    const res = await service.get()
    const extra = [...allKeys(res)].filter((k) => !KEYS_ALLOWED.has(k))
    expect(extra).toEqual([])
    const json = JSON.stringify(res)
    expect(json).not.toContain("C:\\\\sample")
    expect(json).not.toContain("合成の応答")
    for (const item of res.unanswered.items) expect(item.summary.length).toBeLessThanOrEqual(21)
  })

  it("会話ログが無いセッションがあっても落ちない。そのセッションは、コンテキスト整理にも、届かなかった送信にも出ない", async () => {
    const { service, sample } = await sampleService()
    const file = path.join(sample.projectsRoot, "-sample-org-chart", `11111111-1111-4111-8111-${sample.ids.unreachable.slice(-12)}.jsonl`)
    await fs.rm(file)
    const res = await service.get()
    expect(res.cleanup.items.some((i) => i.id === sample.ids.unreachable)).toBe(false)
    expect(res.decisions.items.some((i) => i.id === sample.ids.unreachable)).toBe(false)
    expect(res.cleanup.items.length).toBeGreaterThan(0)
    // 判定できなかったことを、件数つきでお知らせに出す（会話の内容や ID は出さない）
    expect(res.warnings).toEqual(["1件のセッションは会話ログを読めないため判定できません。"])
  })

  it("設定ファイルのしきい値で、整理の候補の判定が変わる（長く止まっている=3時間以上、最小=100K）", async () => {
    const { service, sample } = await sampleService({ sessions: { housekeeping: { idleMs: 3 * 60 * 60_000, minIdleTokens: 100_000 } } })
    const res = await service.get()
    // 3時間以上止まっていて100K以上のセッションは無い（補助Bは196分だが66K）。大きいものだけが残る
    expect(res.cleanup.items.map((i) => [i.id, i.reasons])).toEqual([
      [sample.ids.verify, ["large"]],
      [sample.ids.docs, ["large"]],
    ])
    expect(res.cleanup.idleMinutes).toBe(180)
    expect(res.cleanup.minIdleTokens).toBe(100_000)
  })
})
