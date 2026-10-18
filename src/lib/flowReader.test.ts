import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { FlowSignalReader, applySignalLine, classifyPeer, createSignalEntry } from "./flowReader"
import { SENTINEL, assistantRow, compactRow, humanRow, queuedCommandRow, toJsonl, tsAt } from "./desktopFixtures"

const cleanup: string[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

async function tmpFile(content = ""): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-flow-reader-test-"))
  cleanup.push(dir)
  const file = path.join(dir, "session.jsonl")
  await fs.writeFile(file, content, "utf-8")
  return file
}

const FROM_LEADER = "local_00000000-0000-4000-8000-000000000001"
const peerRow = (text: string, from: unknown, sec = 0, extra: Record<string, unknown> = {}) => ({
  ...humanRow(text, { ts: tsAt(sec), origin: { kind: "peer", from, hostInjected: true } }),
  isMeta: true,
  ...extra,
})

/** 行の並びを取り込んだ結果の信号 */
function signalsOf(rows: unknown[], horizon = 0) {
  const entry = createSignalEntry()
  for (const row of rows) applySignalLine(entry, JSON.stringify(row), horizon)
  return entry.signals
}

describe("classifyPeer", () => {
  it("local_… はDesktopのセッション、uds:… は外部、それ以外（手戻しの形式・形式の違うもの）は描かない", () => {
    expect(classifyPeer(FROM_LEADER)).toEqual({ source: "local", fromId: FROM_LEADER })
    expect(classifyPeer("uds:\\\\.\\pipe\\synthetic")).toEqual({ source: "external", fromId: null })
    expect(classifyPeer("a2b1855e7c")).toEqual({ source: "other", fromId: null })
    expect(classifyPeer("local_a/../b")).toEqual({ source: "other", fromId: null })
    expect(classifyPeer(undefined)).toEqual({ source: "other", fromId: null })
    expect(classifyPeer(123)).toEqual({ source: "other", fromId: null })
  })
})

describe("peer行（他のセッションから届いた入力）", () => {
  it("送り手の種類と本文の先頭20文字（先頭のタグを除く）を取り出す。isMeta が付く形式でも拾う", () => {
    const s = signalsOf([
      peerRow('<cross-session-message from="x">ログイン画面のエラー表示を直してください。それ以外にも沢山ある', FROM_LEADER, 1),
      peerRow("外部からの短い依頼", "uds:\\\\.\\pipe\\synthetic", 2),
      peerRow("手戻しの形式", "a2b1855e7c", 3),
    ])
    expect(s.peers).toEqual([
      { t: Date.parse(tsAt(1)), fromId: FROM_LEADER, source: "local", summary: "ログイン画面のエラー表示を直してください…" },
      { t: Date.parse(tsAt(2)), fromId: null, source: "external", summary: "外部からの短い依頼" },
      { t: Date.parse(tsAt(3)), fromId: null, source: "other", summary: "手戻しの形式" },
    ])
  })

  it("指示の本文は、20文字より後ろを保持しない（目印の文字列が信号に残らない）", () => {
    const s = signalsOf([peerRow(`${"あ".repeat(20)}${SENTINEL}`, FROM_LEADER)])
    expect(s.peers[0].summary).toBe(`${"あ".repeat(20)}…`)
    expect(JSON.stringify(s)).not.toContain(SENTINEL)
  })

  it("text ブロックの配列の本文も読める。peer 以外の人・ツール結果・サブエージェントの行は拾わない", () => {
    const blocks = { ...peerRow("x", FROM_LEADER), message: { role: "user", content: [{ type: "text", text: "配列の本文" }] } }
    const s = signalsOf([
      blocks,
      humanRow("人の入力"),
      peerRow("サブエージェント", FROM_LEADER, 0, { isSidechain: true }),
    ])
    expect(s.peers).toHaveLength(1)
    expect(s.peers[0].summary).toBe("配列の本文")
  })
})

describe("assistant行（ツール呼び出し・送信・ターンの終わり）", () => {
  it("ツール呼び出しを1回ずつ数え、その応答の使用量（入力＋キャッシュ読み取り＋キャッシュ作成）を持つ", () => {
    const s = signalsOf([
      assistantRow({ stop: "tool_use", ts: tsAt(1), input: 10, cacheRead: 5000, cacheCreation: 200, tools: [{ name: "Bash", input: {}, id: "toolu_a" }, { name: "Read", input: {}, id: "toolu_b" }] }),
    ])
    expect(s.tools).toEqual([
      { t: Date.parse(tsAt(1)), ctx: 5210 },
      { t: Date.parse(tsAt(1)), ctx: 5210 },
    ])
  })

  it("同じ tool_use のIDが複数の行に現れても1回と数える。合成の応答は使用量を持たない", () => {
    const row = assistantRow({ stop: "tool_use", ts: tsAt(1), tools: [{ name: "Bash", input: {}, id: "toolu_a" }] })
    const synthetic = assistantRow({ stop: "tool_use", ts: tsAt(2), model: "<synthetic>", tools: [{ name: "Bash", input: {}, id: "toolu_s" }] })
    const s = signalsOf([row, row, synthetic])
    expect(s.tools).toHaveLength(2)
    expect(s.tools[1].ctx).toBeNull()
  })

  it("送信ツール（SendMessage・セッション管理の送信）は、宛先の候補と本文の先頭20文字を持つ。ほかのツールは送信にしない", () => {
    const s = signalsOf([
      assistantRow({
        stop: "tool_use",
        ts: tsAt(1),
        tools: [
          { name: "SendMessage", id: "toolu_1", input: { to: FROM_LEADER, recipient: "メンバーA", message: `${"い".repeat(25)}${SENTINEL}` } },
          { name: "mcp__ccd_session_mgmt__send_message", id: "toolu_2", input: { session_id: "local_x", message: "別の送信" } },
          { name: "Bash", id: "toolu_3", input: { to: "local_y", message: "送信ではない" } },
        ],
      }),
    ])
    expect(s.sends).toEqual([
      { t: Date.parse(tsAt(1)), targets: [FROM_LEADER, "メンバーA"], summary: `${"い".repeat(20)}…` },
      { t: Date.parse(tsAt(1)), targets: ["local_x"], summary: "別の送信" },
    ])
    expect(s.tools).toHaveLength(3)
    expect(JSON.stringify(s)).not.toContain(SENTINEL)
  })

  it("ターンの終わりは stop_reason が tool_use 以外の応答。サブエージェントの行は読まない", () => {
    const s = signalsOf([
      assistantRow({ stop: "tool_use", ts: tsAt(1) }),
      assistantRow({ stop: "end_turn", ts: tsAt(2) }),
      assistantRow({ stop: "end_turn", ts: tsAt(3), sidechain: true }),
    ])
    expect(s.turnEnds).toEqual([Date.parse(tsAt(2))])
  })

  it("圧縮（compact_boundary）の前後のトークン量を取り出す", () => {
    const s = signalsOf([compactRow(tsAt(4))])
    expect(s.compacts).toEqual([{ t: Date.parse(tsAt(4)), pre: 1000, post: 100 }])
  })

  it("保持する期間より前の信号は捨てる。壊れた行・無関係な行は読み飛ばす", () => {
    const horizon = Date.parse(tsAt(10))
    const entry = createSignalEntry()
    for (const row of [
      peerRow("古い", FROM_LEADER, 5),
      peerRow("新しい", FROM_LEADER, 15),
      assistantRow({ stop: "end_turn", ts: tsAt(5) }),
      assistantRow({ stop: "end_turn", ts: tsAt(15) }),
    ]) {
      applySignalLine(entry, JSON.stringify(row), horizon)
    }
    applySignalLine(entry, '{"type":"assistant","message":', horizon)
    applySignalLine(entry, JSON.stringify({ type: "queue-operation" }), horizon)
    expect(entry.signals.peers.map((p) => p.summary)).toEqual(["新しい"])
    expect(entry.signals.turnEnds).toEqual([Date.parse(tsAt(15))])
  })
})

describe("FlowSignalReader（差分読み）", () => {
  const rowsA = [peerRow("最初", FROM_LEADER, 1), assistantRow({ stop: "end_turn", ts: tsAt(2) })]
  const rowsB = [peerRow("追記", FROM_LEADER, 3), assistantRow({ stop: "end_turn", ts: tsAt(4) })]

  it("追記された分だけを読み足す。変わっていないファイルは2回目に読み直さない", async () => {
    const file = await tmpFile(toJsonl(rowsA))
    const reader = new FlowSignalReader()
    const first = await reader.read(file, 0)
    expect(first.peers.map((p) => p.summary)).toEqual(["最初"])
    const afterFirst = reader.bytesRead
    expect(afterFirst).toBe((await fs.stat(file)).size)

    await reader.read(file, 0)
    expect(reader.bytesRead).toBe(afterFirst)

    await fs.appendFile(file, toJsonl(rowsB), "utf-8")
    const third = await reader.read(file, 0)
    expect(third.peers.map((p) => p.summary)).toEqual(["最初", "追記"])
    expect(reader.bytesRead - afterFirst).toBe(Buffer.byteLength(toJsonl(rowsB)))
  })

  it("改行で終わっていない最後の行は次回に回す。サイズが減ったら最初から読み直す", async () => {
    const file = await tmpFile(toJsonl(rowsA))
    const reader = new FlowSignalReader()
    await reader.read(file, 0)

    const half = JSON.stringify(rowsB[0])
    await fs.appendFile(file, half.slice(0, 30), "utf-8")
    expect((await reader.read(file, 0)).peers).toHaveLength(1)
    await fs.appendFile(file, `${half.slice(30)}\n`, "utf-8")
    expect((await reader.read(file, 0)).peers.map((p) => p.summary)).toEqual(["最初", "追記"])

    await fs.writeFile(file, toJsonl([peerRow("作り直し", FROM_LEADER, 9)]), "utf-8")
    expect((await reader.read(file, 0)).peers.map((p) => p.summary)).toEqual(["作り直し"])
  })

  it("ファイルが無ければ空の信号。保持する期間より前に更新されたファイルは読まず、追記があればその分だけ読む", async () => {
    const reader = new FlowSignalReader()
    const missing = await reader.read(path.join(os.tmpdir(), "ccd-no-such-file.jsonl"), 0)
    expect(missing.peers).toEqual([])

    const file = await tmpFile(toJsonl(rowsA))
    const old = new Date(Date.now() - 3 * 24 * 3600 * 1000)
    await fs.utimes(file, old, old)
    const skipped = await reader.read(file, Date.now() - 24 * 3600 * 1000)
    expect(skipped.peers).toEqual([])
    expect(reader.bytesRead).toBe(0)

    await fs.appendFile(file, toJsonl([peerRow("追記", FROM_LEADER, 3)]), "utf-8")
    const after = await reader.read(file, 0)
    expect(after.peers.map((p) => p.summary)).toEqual(["追記"])
  })

  it("同じファイルへの同時の呼び出しでも、同じ位置を2回読まない", async () => {
    const file = await tmpFile(toJsonl(rowsA))
    const reader = new FlowSignalReader()
    const [a, b] = await Promise.all([reader.read(file, 0), reader.read(file, 0)])
    expect(a.peers).toHaveLength(1)
    expect(b.peers).toHaveLength(1)
    expect(reader.bytesRead).toBe((await fs.stat(file)).size)
  })
})

describe("作業中に届いたpeer（queued_command）", () => {
  it("受け手が作業中のときに届いた他セッションのメッセージも、peer行と同じように取り出す（送り手の種類・先頭20文字）", () => {
    const s = signalsOf([
      queuedCommandRow('<cross-session-message from="x">作業中に届いた依頼です。ログイン画面を直してください</cross-session-message>', {
        ts: tsAt(1),
        origin: { kind: "peer", from: FROM_LEADER, hostInjected: true },
      }),
      queuedCommandRow("外部からの連絡", { ts: tsAt(2), origin: { kind: "peer", from: "uds:\\\\.\\pipe\\synthetic" } }),
      queuedCommandRow("手戻しの形式", { ts: tsAt(3), origin: { kind: "peer", from: "a2b1855e7c" } }),
    ])
    expect(s.peers).toEqual([
      { t: Date.parse(tsAt(1)), fromId: FROM_LEADER, source: "local", summary: "作業中に届いた依頼です。ログイン画面を直…" },
      { t: Date.parse(tsAt(2)), fromId: null, source: "external", summary: "外部からの連絡" },
      { t: Date.parse(tsAt(3)), fromId: null, source: "other", summary: "手戻しの形式" },
    ])
  })

  it("人・通知・システムの queued_command、サブエージェントの行、保持する期間より前の行は拾わない。本文は20文字より後ろを保持しない", () => {
    const horizon = Date.parse(tsAt(10))
    const s = signalsOf(
      [
        queuedCommandRow("人の入力", { ts: tsAt(11) }),
        queuedCommandRow("<task-notification>完了</task-notification>", { ts: tsAt(12), origin: { kind: "task-notification" } }),
        queuedCommandRow("サブエージェント", { ts: tsAt(13), sidechain: true, origin: { kind: "peer", from: FROM_LEADER } }),
        queuedCommandRow("古い連絡", { ts: tsAt(1), origin: { kind: "peer", from: FROM_LEADER } }),
        queuedCommandRow("二十文字を超える本文 " + SENTINEL, { ts: tsAt(14), origin: { kind: "peer", from: FROM_LEADER } }),
      ],
      horizon
    )
    expect(s.peers).toHaveLength(1)
    expect(JSON.stringify(s.peers)).not.toContain(SENTINEL)
  })

  it("同じメッセージが user の行と queued_command の両方に書かれることは無いが、別々の2通は2件と数える", () => {
    const s = signalsOf([
      peerRow("user行で届いた依頼", FROM_LEADER, 1),
      queuedCommandRow("作業中に届いた依頼", { ts: tsAt(2), origin: { kind: "peer", from: FROM_LEADER } }),
    ])
    expect(s.peers.map((p) => p.summary)).toEqual(["user行で届いた依頼", "作業中に届いた依頼"])
  })
})
