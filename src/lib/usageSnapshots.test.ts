import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { parseSnapshotLine, readSnapshots } from "./usageSnapshots"

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

/** 合成の記録。recordedBy には、漏れていないことを確かめるための目印を入れる */
function snapshotLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ts: "2026-10-18T11:27:54Z",
    source: "get_usage",
    recordedBy: "SENTINEL-RECORDER",
    plan: "Pro",
    windows: [
      { key: "five_hour", label: "5-hour limit", percentUsed: 2, resetsAt: "2026-10-18T16:19:59.523Z" },
      { key: "weekly_all", label: "Weekly · all models", percentUsed: 14, resetsAt: "2026-10-24T02:59:59.524Z" },
      { key: "weekly_model", model: "Fable", label: "Weekly · Fable", percentUsed: 0, resetsAt: "2026-10-24T03:00:00.000Z" },
    ],
    extraUsage: { enabled: false },
    ...overrides,
  })
}

describe("parseSnapshotLine", () => {
  it("時刻・プラン・3つの窓・追加利用を取り出す。recordedBy と source は取り込まない", () => {
    const snapshot = parseSnapshotLine(snapshotLine())
    expect(snapshot).toEqual({
      ts: Date.parse("2026-10-18T11:27:54Z"),
      plan: "Pro",
      windows: [
        { key: "five_hour", modelName: null, label: "5-hour limit", percentUsed: 2, resetsAt: Date.parse("2026-10-18T16:19:59.523Z") },
        { key: "weekly_all", modelName: null, label: "Weekly · all models", percentUsed: 14, resetsAt: Date.parse("2026-10-24T02:59:59.524Z") },
        { key: "weekly_model", modelName: "Fable", label: "Weekly · Fable", percentUsed: 0, resetsAt: Date.parse("2026-10-24T03:00:00.000Z") },
      ],
      extraUsage: { enabled: false, spent: null },
    })
    expect(JSON.stringify(snapshot)).not.toContain("SENTINEL")
  })

  it("weekly_model のモデル名は model が無ければ label の「·」の後ろから取る。どちらも無ければその窓は使わない", () => {
    const fromLabel = parseSnapshotLine(
      snapshotLine({ windows: [{ key: "weekly_model", label: "Weekly · Sonnet", percentUsed: 5, resetsAt: "2026-10-24T03:00:00Z" }] })
    )
    expect(fromLabel?.windows[0].modelName).toBe("Sonnet")
    const none = parseSnapshotLine(
      snapshotLine({
        windows: [
          { key: "weekly_model", label: "Weekly", percentUsed: 5, resetsAt: "2026-10-24T03:00:00Z" },
          { key: "five_hour", label: "5-hour limit", percentUsed: 1, resetsAt: "2026-10-18T16:00:00Z" },
        ],
      })
    )
    expect(none?.windows.map((w) => w.key)).toEqual(["five_hour"])
  })

  it("追加利用は、オン・オフと使った金額を取り出す", () => {
    expect(parseSnapshotLine(snapshotLine({ extraUsage: { enabled: true, spent: 12.5 } }))?.extraUsage).toEqual({ enabled: true, spent: 12.5 })
    expect(parseSnapshotLine(snapshotLine({ extraUsage: { enabled: true, spent: "x" } }))?.extraUsage).toEqual({ enabled: true, spent: null })
    expect(parseSnapshotLine(snapshotLine({ extraUsage: "on" }))?.extraUsage).toBeNull()
  })

  it("不正な行・時刻や窓が無い行・不正な窓は読み飛ばす", () => {
    expect(parseSnapshotLine("not json")).toBeNull()
    expect(parseSnapshotLine(snapshotLine({ ts: "yesterday" }))).toBeNull()
    expect(parseSnapshotLine(snapshotLine({ windows: [] }))).toBeNull()
    expect(parseSnapshotLine(snapshotLine({ windows: "x" }))).toBeNull()
    const partial = parseSnapshotLine(
      snapshotLine({
        windows: [
          { key: "five_hour", label: "a", percentUsed: -1, resetsAt: "2026-10-18T16:00:00Z" },
          { key: "other", label: "b", percentUsed: 5, resetsAt: "2026-10-18T16:00:00Z" },
          { key: "five_hour", label: "c", percentUsed: 5, resetsAt: "bad" },
          { key: "weekly_all", label: "ok", percentUsed: 7, resetsAt: "2026-10-24T03:00:00Z" },
        ],
      })
    )
    expect(partial?.windows).toHaveLength(1)
    expect(partial?.windows[0].key).toBe("weekly_all")
  })
})

describe("readSnapshots", () => {
  async function tmpFile(content: string): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-usage-snap-"))
    cleanup.push(dir)
    const file = path.join(dir, "usage-snapshots.jsonl")
    await fs.writeFile(file, content)
    return file
  }

  it("ファイルが無ければ found=false", async () => {
    expect(await readSnapshots(path.join(os.tmpdir(), "ccd-no-such-snapshots.jsonl"))).toEqual({ found: false, snapshots: [] })
  })

  it("記録を時刻順(古い順)に読む。壊れた行は読み飛ばす", async () => {
    const file = await tmpFile(
      [snapshotLine({ ts: "2026-10-18T12:00:00Z" }), "broken line", snapshotLine({ ts: "2026-10-18T10:00:00Z" }), ""].join("\n")
    )
    const result = await readSnapshots(file)
    expect(result.found).toBe(true)
    expect(result.snapshots.map((s) => new Date(s.ts).toISOString())).toEqual(["2026-10-18T10:00:00.000Z", "2026-10-18T12:00:00.000Z"])
  })

  it("空のファイルは found=true で記録なし", async () => {
    expect(await readSnapshots(await tmpFile(""))).toEqual({ found: true, snapshots: [] })
  })
})
