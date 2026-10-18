import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { UsageService } from "./usageService"

const HOUR = 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 18, 12, 0, 0)
const cleanup: string[] = []

async function tmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-usage-service-"))
  cleanup.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

/** opus-5-5(出力 $20/100万トークン)で、ちょうど dollars ドルになる合成の行 */
function assistantLine(id: string, at: number, dollars: number): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: new Date(at).toISOString(),
    message: {
      id,
      model: "claude-opus-5-5",
      usage: { input_tokens: 0, output_tokens: Math.round((dollars / 20) * 1_000_000), cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      content: [{ type: "text", text: "SENTINEL-BODY-TEXT" }],
    },
  })
}

function snapshotLine(ts: number, percent: number): string {
  return JSON.stringify({
    ts: new Date(ts).toISOString(),
    source: "get_usage",
    recordedBy: "SENTINEL-RECORDER",
    plan: "Pro",
    windows: [
      { key: "five_hour", label: "5-hour limit", percentUsed: percent, resetsAt: new Date(NOW + 2 * HOUR).toISOString() },
      { key: "weekly_all", label: "Weekly · all models", percentUsed: 14, resetsAt: new Date(NOW + 5 * 24 * HOUR).toISOString() },
    ],
    extraUsage: { enabled: true, spent: 3.5 },
  })
}

async function setup(): Promise<{ projectsRoot: string; snapshotsPath: string }> {
  const root = await tmpDir()
  const projectsRoot = path.join(root, "projects")
  await fs.mkdir(path.join(projectsRoot, "proj-a"), { recursive: true })
  // 同じ応答が3行に分かれた記録(重複を除いて、$10 として数える)
  const lines = [
    assistantLine("msg_1", NOW - 2 * HOUR, 10),
    assistantLine("msg_1", NOW - 2 * HOUR, 10),
    assistantLine("msg_1", NOW - 2 * HOUR, 10),
    assistantLine("msg_2", NOW - 30 * 60 * 1000, 2),
  ]
  await fs.writeFile(path.join(projectsRoot, "proj-a", "session-1.jsonl"), lines.join("\n") + "\n")
  const snapshotsPath = path.join(root, "usage-snapshots.jsonl")
  await fs.writeFile(snapshotsPath, snapshotLine(NOW - HOUR, 10) + "\n")
  return { projectsRoot, snapshotsPath }
}

describe("UsageService.get", () => {
  it("公式値・推定・枠の中の使用量を組み立てる(重複した行は1回だけ数える)", async () => {
    const { projectsRoot, snapshotsPath } = await setup()
    const service = new UsageService({ projectsRoot, snapshotsPath, now: () => NOW })
    const res = await service.get()

    expect(res.generatedAt).toBe(NOW)
    expect(res.snapshots).toEqual({ found: true, count: 1, lastRecordedAt: NOW - HOUR, plan: "Pro" })
    expect(res.extraUsage).toEqual({ enabled: true, spent: 3.5 })
    const five = res.windows.find((w) => w.key === "five_hour")
    expect(five?.official?.percentUsed).toBe(10)
    expect(five?.costUsd).toBeCloseTo(12, 6)
    expect(five?.estimate.kind).toBe("estimate")
    expect(res.guard.level).toBe("none")
    expect(res.unregisteredModels).toEqual([])
  })

  it("返すのは許可リストの項目だけ: 公式値の記録のrecordedByも、会話の本文も含まない", async () => {
    const { projectsRoot, snapshotsPath } = await setup()
    const service = new UsageService({ projectsRoot, snapshotsPath, now: () => NOW })
    const json = JSON.stringify(await service.get())
    expect(json).not.toContain("SENTINEL")
    expect(json).not.toContain("recordedBy")
    expect(json).not.toContain(projectsRoot)
  })

  it("セッション別の消費は、Desktopのセッション(名前・グループ)に対応づけられる。対応しないものは名前を出さない", async () => {
    const { projectsRoot, snapshotsPath } = await setup()
    const withIdentity = new UsageService({
      projectsRoot,
      snapshotsPath,
      now: () => NOW,
      identities: async () =>
        new Map([["session-1", { desktopId: "local_synthetic", title: "合成セッション", groupId: "g1", groupName: "合成グループ" }]]),
    })
    const res = await withIdentity.get()
    expect(res.contributions.fiveHour.items).toHaveLength(1)
    expect(res.contributions.fiveHour.items[0]).toMatchObject({
      sessionKey: "session-1",
      desktopId: "local_synthetic",
      title: "合成セッション",
      groupName: "合成グループ",
    })
    expect(res.contributions.fiveHour.items[0].costUsd).toBeCloseTo(12, 6)
    expect(res.contributions.week.items[0].costUsd).toBeCloseTo(12, 6)

    const without = await new UsageService({ projectsRoot, snapshotsPath, now: () => NOW }).get()
    expect(without.contributions.fiveHour.items[0]).toMatchObject({ desktopId: null, groupName: null })
  })

  it("公式値の記録が無くても、エラーにならない(窓は空、記録なしと分かる)", async () => {
    const { projectsRoot } = await setup()
    const res = await new UsageService({
      projectsRoot,
      snapshotsPath: path.join(os.tmpdir(), "ccd-no-such-snapshots.jsonl"),
      now: () => NOW,
    }).get()
    expect(res.snapshots).toEqual({ found: false, count: 0, lastRecordedAt: null, plan: null })
    expect(res.windows).toEqual([])
    expect(res.extraUsage).toBeNull()
    // 使用量の集計は、記録が無くても出せる
    expect(res.contributions.fiveHour.items).toHaveLength(1)
  })

  it("公式値の記録に追記されたら、次の取得で反映される", async () => {
    const { projectsRoot, snapshotsPath } = await setup()
    const service = new UsageService({ projectsRoot, snapshotsPath, now: () => NOW })
    expect((await service.get()).guard.level).toBe("none")
    await fs.appendFile(snapshotsPath, snapshotLine(NOW - 1000, 93) + "\n")
    const res = await service.get()
    expect(res.snapshots.count).toBe(2)
    expect(res.guard).toMatchObject({ level: "high", percent: 93 })
  })

  it("価格表の上書きが反映される(単価を2倍にすると、枠の中の金額も2倍)", async () => {
    const { projectsRoot, snapshotsPath } = await setup()
    const base = await new UsageService({ projectsRoot, snapshotsPath, now: () => NOW }).get()
    const doubled = await new UsageService({
      projectsRoot,
      snapshotsPath,
      now: () => NOW,
      prices: { "claude-opus-5-5": { input: 8, output: 40, cacheRead: 0.4 } },
    }).get()
    const cost = (r: typeof base) => r.windows.find((w) => w.key === "five_hour")?.costUsd ?? 0
    expect(cost(doubled)).toBeCloseTo(cost(base) * 2, 6)
  })
})
