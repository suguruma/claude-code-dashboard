import { describe, expect, it, vi } from "vitest"
import { LAN_HEADER } from "./lanAccess/config"
import type { UsageContribution, UsageResponse } from "./usageTypes"

const item = (key: string): UsageContribution => ({
  sessionKey: key,
  desktopId: null,
  title: "合成のセッション",
  groupId: null,
  groupName: null,
  costUsd: 1,
  tokens: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
  models: [{ family: "Opus", subagent: false, tokens: 4, costUsd: 1 }],
  subagents: 2,
})

const sample = {
  generatedAt: 0,
  contributions: { fiveHour: { since: 0, items: [item("a")] }, week: { since: 0, items: [item("a"), item("b")] } },
} as unknown as UsageResponse

vi.mock("@/lib/usageService", () => ({
  getUsageService: async () => ({ get: async () => sample, getOfficial: async () => sample }),
}))

describe("[AG-7][低7] LAN の /api/usage にはセッションごとの内訳を出さない", () => {
  async function read(viaLan: boolean): Promise<UsageResponse> {
    const { GET } = await import("@/app/api/usage/route")
    const headers: Record<string, string> = viaLan ? { [LAN_HEADER]: "1" } : {}
    const res = await GET(new Request("http://127.0.0.1/api/usage", { headers }))
    expect(res.status).toBe(200)
    return (await res.json()) as UsageResponse
  }

  it("LAN の印つきでは models・subagents が無く、PC では残る", async () => {
    const lan = await read(true)
    const items = [...lan.contributions.fiveHour.items, ...lan.contributions.week.items]
    expect(items).toHaveLength(3)
    for (const i of items) {
      expect(i).not.toHaveProperty("models")
      expect(i).not.toHaveProperty("subagents")
      expect(i.costUsd).toBe(1)
    }
    const pc = await read(false)
    expect(pc.contributions.week.items[0].models).toHaveLength(1)
    expect(pc.contributions.week.items[0].subagents).toBe(2)
  })
})
