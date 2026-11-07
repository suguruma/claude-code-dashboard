import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { buildContributions, buildSessionBreakdown } from "./usageEstimate"
import { UsageLedger, type UsageRow } from "./usageLedger"
import { PriceBook } from "./usagePricing"
import { breakdownText } from "./scheduledActivityText"

const NOW = Date.UTC(2026, 10, 10, 3, 0, 0)
const HOUR = 3600_000
const prices = new PriceBook()
const cleanup: string[] = []
afterEach(async () => {
  for (const d of cleanup.splice(0)) await fs.rm(d, { recursive: true, force: true })
})

let seq = 0
function row(sessionKey: string, model: string, o: Partial<UsageRow> = {}): UsageRow {
  return {
    id: `m${++seq}`,
    at: NOW - HOUR,
    model,
    sessionKey,
    dirName: "d",
    subagent: false,
    input: 10,
    output: 1000,
    cacheRead: 50_000,
    cacheWrite5m: 2000,
    cacheWrite1h: 0,
    ...o,
  }
}

const total = (r: { tokens: { input: number; output: number; cacheRead: number; cacheWrite: number } }) =>
  r.tokens.input + r.tokens.output + r.tokens.cacheRead + r.tokens.cacheWrite

describe("[AG-4][A4] 今週の消費のモデル別の内訳とサブエージェントの本数", () => {
  it("内訳の合計が、同じセッションのトークンと重さに一致する。サブエージェントは記録の本数で数える", () => {
    const rows = [
      row("s1", "claude-opus-5-5"),
      row("s1", "claude-opus-5-0"),
      row("s1", "claude-haiku-5-5", { subagent: true, agent: "agent-a" }),
      row("s1", "claude-haiku-5-5", { subagent: true, agent: "agent-a" }),
      row("s1", "claude-sonnet-5-5", { subagent: true, agent: "agent-b" }),
      row("s2", "claude-sonnet-5-5"),
      row("s1", "claude-opus-5-5", { at: NOW - 30 * 24 * HOUR }),
    ]
    const set = buildContributions(rows, NOW - 7 * 24 * HOUR, NOW, prices, () => null)
    const s1 = set.items.find((i) => i.sessionKey === "s1")!
    expect(s1.models?.filter((m) => !m.subagent).map((m) => m.family)).toEqual(["Opus"])
    expect(s1.models?.filter((m) => m.subagent).map((m) => m.family).sort()).toEqual(["Haiku", "Sonnet"])
    expect(s1.models!.reduce((a, m) => a + m.tokens, 0)).toBe(total(s1))
    expect(s1.models!.reduce((a, m) => a + m.costUsd, 0)).toBeCloseTo(s1.costUsd, 10)
    expect(s1.subagents).toBe(2)
    const s2 = set.items.find((i) => i.sessionKey === "s2")!
    expect(s2).toMatchObject({ subagents: 0 })
    expect(s2.models?.map((m) => m.family)).toEqual(["Sonnet"])
  })

  it("41件目からまとめた「ほか n件」も、内訳とサブエージェントの本数を足し合わせる", () => {
    const rows: UsageRow[] = []
    for (let i = 0; i < 43; i++) {
      rows.push(row(`k${i}`, "claude-opus-5-5", { output: 10_000 - i }))
      rows.push(row(`k${i}`, "claude-haiku-5-5", { subagent: true, agent: `agent-${i}` }))
    }
    const set = buildContributions(rows, NOW - 7 * 24 * HOUR, NOW, prices, () => null)
    const other = set.items.at(-1)!
    expect(other.title).toBe("ほか3件")
    expect(other.subagents).toBe(3)
    expect(other.models!.reduce((a, m) => a + m.tokens, 0)).toBe(total(other))
  })

  it("[AG-5] セッションの詳細の1行：期間とセッションで絞り、文は［利用上限］と同じ書き方", () => {
    const rows = [
      row("s1", "claude-opus-5-5", { output: 2_400_000 - 52_010 }),
      row("s1", "claude-haiku-5-5", { subagent: true, agent: "agent-a", cacheRead: 628_000 - 3010 }),
      row("s2", "claude-opus-5-5"),
      row("s1", "claude-opus-5-5", { at: NOW - 8 * 24 * HOUR }),
    ]
    const b = buildSessionBreakdown(rows, new Set(["s1"]), NOW - 7 * 24 * HOUR, NOW, prices)
    expect(b.models.map((m) => [m.family, m.subagent, m.tokens])).toEqual([
      ["Opus", false, 2_400_000],
      ["Haiku", true, 628_000],
    ])
    expect(b.subagents).toBe(1)
    expect(breakdownText(b.models, b.subagents)).toBe("Opus 2.4M・サブ Haiku 628K・サブエージェント 1本")
    expect(breakdownText([], 0)).toBeNull()
  })

  it("台帳はサブエージェントの行に記録の名前を付ける(本体の行には付けない)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-breakdown-"))
    cleanup.push(root)
    const dir = path.join(root, "proj")
    const line = (id: string, model: string) =>
      JSON.stringify({ type: "assistant", timestamp: new Date(NOW - HOUR).toISOString(), message: { id, model, usage: { input_tokens: 1, output_tokens: 2 } } })
    await fs.mkdir(path.join(dir, "sess-0001", "subagents"), { recursive: true })
    await fs.writeFile(path.join(dir, "sess-0001.jsonl"), line("a", "claude-opus-5-5") + "\n")
    await fs.writeFile(path.join(dir, "sess-0001", "subagents", "agent-x1.jsonl"), line("b", "claude-haiku-5-5") + "\n")
    const ledger = new UsageLedger({ projectsRoot: root, now: () => NOW })
    await ledger.refresh()
    const rows = ledger.rows()
    expect(rows.find((r) => r.id === "a")?.agent).toBeUndefined()
    expect(rows.find((r) => r.id === "b")).toMatchObject({ subagent: true, agent: "agent-x1", sessionKey: "sess-0001" })
  })
})

describe("[AG-5][A7] セッション1件の内訳の API", () => {
  it("会話ログの ID の形に合わないと 400(パスに使わない)", async () => {
    const { GET } = await import("@/app/api/usage/session/route")
    expect((await GET(new Request("http://127.0.0.1/api/usage/session?key=../x"))).status).toBe(400)
    expect((await GET(new Request("http://127.0.0.1/api/usage/session"))).status).toBe(400)
  })
})
