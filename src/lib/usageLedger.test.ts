import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { UsageLedger, parseUsageLine, preferRow } from "./usageLedger"

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0)
const HOUR = 60 * 60 * 1000

const cleanup: string[] = []

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-usage-ledger-"))
  cleanup.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

interface LineOptions {
  id: string
  at?: number
  model?: string
  input?: number
  output?: number
  cacheRead?: number
  creation?: number
  split?: { m5?: number; h1?: number } | null
  synthetic?: boolean
  apiError?: boolean
  spaced?: boolean
}

/** 合成の会話記録の1行(assistant)。本文には、漏れていないことを確かめるための目印を入れる */
function assistantLine(o: LineOptions): string {
  const usage: Record<string, unknown> = {
    input_tokens: o.input ?? 10,
    output_tokens: o.output ?? 20,
    cache_read_input_tokens: o.cacheRead ?? 100,
    cache_creation_input_tokens: o.creation ?? 0,
  }
  if (o.split !== null) {
    usage.cache_creation = {
      ephemeral_5m_input_tokens: o.split?.m5 ?? o.creation ?? 0,
      ephemeral_1h_input_tokens: o.split?.h1 ?? 0,
    }
  }
  const entry = {
    type: "assistant",
    timestamp: new Date(o.at ?? NOW - HOUR).toISOString(),
    ...(o.apiError ? { isApiErrorMessage: true } : {}),
    message: {
      id: o.id,
      model: o.synthetic ? "<synthetic>" : (o.model ?? "claude-opus-5-5"),
      usage,
      content: [{ type: "text", text: "SENTINEL-BODY-TEXT" }],
    },
  }
  return o.spaced ? JSON.stringify(entry).replace('"type":"assistant"', '"type": "assistant"') : JSON.stringify(entry)
}

async function writeLines(file: string, lines: string[], trailingNewline = true): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, lines.join("\n") + (trailingNewline ? "\n" : ""))
}

describe("parseUsageLine", () => {
  it("応答の使用量・時刻・モデル・IDを取り出す", () => {
    const row = parseUsageLine(assistantLine({ id: "msg_t1", at: NOW, model: "claude-sonnet-5-5", input: 5, output: 7, cacheRead: 9 }))
    expect(row).toEqual({
      id: "msg_t1",
      at: NOW,
      model: "claude-sonnet-5-5",
      input: 5,
      output: 7,
      cacheRead: 9,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
    })
  })

  it("会話の本文は取り込まない(取り出す項目は使用量・時刻・モデル・IDだけ)", () => {
    const row = parseUsageLine(assistantLine({ id: "msg_t1" }))
    expect(JSON.stringify(row)).not.toContain("SENTINEL")
    expect(Object.keys(row ?? {}).sort()).toEqual(["at", "cacheRead", "cacheWrite1h", "cacheWrite5m", "id", "input", "model", "output"])
  })

  it("キャッシュ作成は、5分と1時間の内訳で分ける", () => {
    const row = parseUsageLine(assistantLine({ id: "msg_t1", creation: 1000, split: { m5: 400, h1: 600 } }))
    expect(row).toMatchObject({ cacheWrite5m: 400, cacheWrite1h: 600 })
  })

  it("内訳に含まれない分、内訳が無い古い形式は、5分のキャッシュとして数える", () => {
    expect(parseUsageLine(assistantLine({ id: "msg_t1", creation: 1000, split: null }))).toMatchObject({ cacheWrite5m: 1000, cacheWrite1h: 0 })
    expect(parseUsageLine(assistantLine({ id: "msg_t2", creation: 1000, split: { m5: 100, h1: 200 } }))).toMatchObject({
      cacheWrite5m: 800,
      cacheWrite1h: 200,
    })
  })

  it("キーの後に空白がある形式でも読める", () => {
    expect(parseUsageLine(assistantLine({ id: "msg_t1", spaced: true }))).not.toBeNull()
  })

  it("合成の応答・APIエラー・IDやモデルが無い行・壊れた行・assistant以外は数えない", () => {
    expect(parseUsageLine(assistantLine({ id: "msg_s", synthetic: true }))).toBeNull()
    expect(parseUsageLine(assistantLine({ id: "msg_e", apiError: true }))).toBeNull()
    expect(parseUsageLine(assistantLine({ id: "" }))).toBeNull()
    expect(parseUsageLine('{"type":"assistant","message":{"usage":{"input_tokens":1}}}')).toBeNull()
    expect(parseUsageLine('{"type":"assistant","usage" broken')).toBeNull()
    expect(parseUsageLine('{"type":"user","message":{"usage":{}}}')).toBeNull()
    expect(parseUsageLine('{"type":"assistant","timestamp":"not a date","message":{"id":"m","model":"x","usage":{}}}')).toBeNull()
  })

  it("数値でない・負のトークン数は0として扱う", () => {
    const line = JSON.stringify({
      type: "assistant",
      timestamp: new Date(NOW).toISOString(),
      message: { id: "msg_t1", model: "claude-opus-5-5", usage: { input_tokens: "5", output_tokens: -3, cache_read_input_tokens: null } },
    })
    expect(parseUsageLine(line)).toMatchObject({ input: 0, output: 0, cacheRead: 0 })
  })
})

describe("preferRow", () => {
  it("出力が大きい方を採る。同じなら先に見つけた方", () => {
    const a = { id: "x", output: 5, tag: "a" }
    expect(preferRow(a, { id: "x", output: 9, tag: "b" }).tag).toBe("b")
    expect(preferRow(a, { id: "x", output: 5, tag: "b" }).tag).toBe("a")
    expect(preferRow(a, { id: "x", output: 1, tag: "b" }).tag).toBe("a")
  })
})

describe("UsageLedger", () => {
  it("1つの応答が複数行に分かれていても、message.idで1回だけ数える", async () => {
    const root = await makeRoot()
    await writeLines(path.join(root, "proj-a", "session-1.jsonl"), [
      assistantLine({ id: "msg_1", output: 20 }),
      assistantLine({ id: "msg_1", output: 20 }),
      assistantLine({ id: "msg_1", output: 20 }),
      assistantLine({ id: "msg_2", output: 30 }),
    ])
    const ledger = new UsageLedger({ projectsRoot: root, now: () => NOW })
    await ledger.refresh()
    const rows = ledger.rows()
    expect(rows.map((r) => r.id).sort()).toEqual(["msg_1", "msg_2"])
  })

  it("usageが違う重複は、出力が最大の行を採る(行の順序に依存しない)", async () => {
    const root = await makeRoot()
    await writeLines(path.join(root, "proj-a", "s1.jsonl"), [
      assistantLine({ id: "msg_1", output: 5 }),
      assistantLine({ id: "msg_1", output: 90 }),
      assistantLine({ id: "msg_1", output: 40 }),
    ])
    await writeLines(path.join(root, "proj-a", "s2.jsonl"), [assistantLine({ id: "msg_2", output: 90 }), assistantLine({ id: "msg_2", output: 5 })])
    const ledger = new UsageLedger({ projectsRoot: root, now: () => NOW })
    await ledger.refresh()
    const byId = new Map(ledger.rows().map((r) => [r.id, r]))
    expect(byId.get("msg_1")?.output).toBe(90)
    expect(byId.get("msg_2")?.output).toBe(90)
  })

  it("サブエージェントの会話記録も読み、親のセッションIDで集計する。本体とサブエージェントで同じIDは1回だけ", async () => {
    const root = await makeRoot()
    await writeLines(path.join(root, "proj-a", "session-1.jsonl"), [assistantLine({ id: "msg_main" }), assistantLine({ id: "msg_shared", output: 10 })])
    await writeLines(path.join(root, "proj-a", "session-1", "subagents", "agent-x.jsonl"), [
      assistantLine({ id: "msg_sub", model: "claude-sonnet-5-5" }),
      assistantLine({ id: "msg_shared", output: 10 }),
    ])
    const ledger = new UsageLedger({ projectsRoot: root, now: () => NOW })
    await ledger.refresh()
    const rows = ledger.rows()
    expect(rows.map((r) => r.id).sort()).toEqual(["msg_main", "msg_shared", "msg_sub"])
    const sub = rows.find((r) => r.id === "msg_sub")
    expect(sub).toMatchObject({ sessionKey: "session-1", subagent: true, dirName: "proj-a" })
    expect(rows.find((r) => r.id === "msg_main")).toMatchObject({ sessionKey: "session-1", subagent: false })
  })

  it("期間(15日)より古い応答は含めない。更新が期間より古いファイルは読まない", async () => {
    const root = await makeRoot()
    const recent = path.join(root, "proj-a", "recent.jsonl")
    await writeLines(recent, [
      assistantLine({ id: "msg_old", at: NOW - 20 * 24 * HOUR }),
      assistantLine({ id: "msg_new", at: NOW - HOUR }),
    ])
    const stale = path.join(root, "proj-a", "stale.jsonl")
    await writeLines(stale, [assistantLine({ id: "msg_stale", at: NOW - 30 * 24 * HOUR })])
    const old = new Date(NOW - 30 * 24 * HOUR)
    await fs.utimes(stale, old, old)
    await fs.utimes(recent, new Date(NOW), new Date(NOW))

    const ledger = new UsageLedger({ projectsRoot: root, now: () => NOW })
    await ledger.refresh()
    expect(ledger.rows().map((r) => r.id)).toEqual(["msg_new"])
  })

  it("追記された分だけを読み足す。改行で終わっていない最後の行は、完結するまで数えない", async () => {
    const root = await makeRoot()
    const file = path.join(root, "proj-a", "s1.jsonl")
    await writeLines(file, [assistantLine({ id: "msg_1" })])
    const ledger = new UsageLedger({ projectsRoot: root, now: () => NOW })
    await ledger.refresh()
    expect(ledger.rows()).toHaveLength(1)

    const second = assistantLine({ id: "msg_2" })
    await fs.appendFile(file, second.slice(0, 40)) // 書き込み途中
    await ledger.refresh()
    expect(ledger.rows().map((r) => r.id)).toEqual(["msg_1"])

    await fs.appendFile(file, second.slice(40) + "\n" + assistantLine({ id: "msg_3" }) + "\n")
    await ledger.refresh()
    expect(ledger.rows().map((r) => r.id).sort()).toEqual(["msg_1", "msg_2", "msg_3"])
  })

  it("ファイルが書き直されて小さくなったら、最初から読み直す", async () => {
    const root = await makeRoot()
    const file = path.join(root, "proj-a", "s1.jsonl")
    await writeLines(file, [assistantLine({ id: "msg_1" }), assistantLine({ id: "msg_2" })])
    const ledger = new UsageLedger({ projectsRoot: root, now: () => NOW })
    await ledger.refresh()
    expect(ledger.rows()).toHaveLength(2)

    await writeLines(file, [assistantLine({ id: "msg_9" })])
    await ledger.refresh()
    expect(ledger.rows().map((r) => r.id)).toEqual(["msg_9"])
  })

  it("応答は時刻順に並ぶ。保持するのは使用量・時刻・モデル・識別子だけで、本文は含まない", async () => {
    const root = await makeRoot()
    await writeLines(path.join(root, "proj-a", "s1.jsonl"), [
      assistantLine({ id: "msg_b", at: NOW - HOUR }),
      assistantLine({ id: "msg_a", at: NOW - 3 * HOUR }),
    ])
    const ledger = new UsageLedger({ projectsRoot: root, now: () => NOW })
    await ledger.refresh()
    const rows = ledger.rows()
    expect(rows.map((r) => r.id)).toEqual(["msg_a", "msg_b"])
    expect(JSON.stringify(rows)).not.toContain("SENTINEL")
  })

  it("会話記録のフォルダが無ければ空", async () => {
    const ledger = new UsageLedger({ projectsRoot: path.join(os.tmpdir(), "ccd-no-such-dir-xyz"), now: () => NOW })
    await ledger.refresh()
    expect(ledger.rows()).toEqual([])
  })
})
