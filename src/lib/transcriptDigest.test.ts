import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import {
  WRAP_UP_TOOL,
  advanceDigest,
  applyEntry,
  applyLine,
  createDigest,
  makeExcerpt,
  readTailDigest,
} from "./transcriptDigest"
import {
  assistantRow,
  compactRow,
  humanRow,
  planRow,
  queueRow,
  toJsonl,
  toolResultRow,
  tsAt,
} from "./desktopFixtures"

const cleanup: string[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

async function tmpFile(content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-digest-test-"))
  cleanup.push(dir)
  const file = path.join(dir, "session.jsonl")
  await fs.writeFile(file, content, "utf-8")
  return file
}

function digestOf(rows: unknown[]) {
  const d = createDigest()
  for (const row of rows) applyEntry(d, row as never)
  return d
}

describe("makeExcerpt", () => {
  it("空白を1つに畳み、長ければ末尾を省略する", () => {
    expect(makeExcerpt("a  b\n\nc", 10)).toBe("a b c")
    expect(makeExcerpt("x".repeat(70), 60)).toBe(`${"x".repeat(60)}…`)
  })
})

describe("最新の指示", () => {
  it("人の指示を60文字に切り詰めて保持し、発信元を区別する", () => {
    const d = digestOf([humanRow("あ".repeat(100), { ts: tsAt(1) })])
    expect(d.latestHuman?.origin).toBe("human")
    expect(d.latestHuman?.excerpt).toBe(`${"あ".repeat(60)}…`)
    expect(d.latestInput).toBe(d.latestHuman)
  })

  it("他セッション由来は peer とし、人の指示を上書きしない(人の指示を優先して出せる)", () => {
    const d = digestOf([
      humanRow("人の指示"),
      humanRow("<cross-session-message from=\"x\">他からの依頼", { origin: { kind: "peer", from: "local_x" } }),
    ])
    expect(d.latestHuman?.excerpt).toBe("人の指示")
    expect(d.latestInput?.origin).toBe("peer")
    expect(d.latestInput?.excerpt).toBe("他からの依頼")
  })

  it("他セッション由来の行は isMeta が付く形式でも指示として拾う(タグなしの文字列)", () => {
    const peerRow = {
      ...humanRow("別セッションからの依頼です", { origin: { kind: "peer", from: "local_x" }, turnOrigin: "peer" }),
      isMeta: true,
    }
    const d = digestOf([humanRow("人の指示"), peerRow])
    expect(d.latestInput).toMatchObject({ origin: "peer", excerpt: "別セッションからの依頼です" })
    expect(d.latestHuman?.excerpt).toBe("人の指示")
    // 人の指示が無くても、他セッションの指示が最新の指示になる
    expect(digestOf([peerRow]).latestInput?.origin).toBe("peer")
  })

  it("isMeta の除外は peer 以外にだけ効く(人・通知の isMeta 行は指示にしない)", () => {
    const metaHuman = { ...humanRow("メタな人の行"), isMeta: true }
    const metaNotification = { ...humanRow("通知"), origin: { kind: "task-notification" }, isMeta: true }
    expect(digestOf([metaHuman]).latestInput).toBeNull()
    expect(digestOf([metaNotification]).latestInput).toBeNull()
  })

  it("通知由来は発信元だけを残し、本文の抜粋は保持しない", () => {
    const d = digestOf([humanRow("<task-notification>done</task-notification>", { origin: { kind: "task-notification" } })])
    expect(d.latestInput).toMatchObject({ origin: "notification", excerpt: "" })
    expect(d.latestHuman).toBeNull()
  })

  it("origin が無い行は turnOrigin から判断する", () => {
    const row = { ...humanRow("定期実行"), origin: undefined, turnOrigin: "scheduled" }
    expect(digestOf([row]).latestInput?.origin).toBe("scheduled")
    const legacy = { ...humanRow("古い形式の人の入力"), origin: undefined }
    expect(digestOf([legacy]).latestHuman?.origin).toBe("human")
  })

  it("ツール結果・メタ行・サブエージェントの行・システムの疑似ユーザー行・中断マークは指示にしない", () => {
    const d = digestOf([
      humanRow("本当の指示"),
      toolResultRow(),
      { ...humanRow("メタ"), isMeta: true },
      humanRow("サブエージェント", { sidechain: true }),
      { ...humanRow("<local-command-stdout>x</local-command-stdout>"), origin: undefined },
      { ...humanRow("This session is being continued from a previous conversation that ran out of context."), isCompactSummary: true },
      humanRow("This session is being continued from a previous conversation (形式違い)"),
      humanRow("[Request interrupted by user for tool use]"),
    ])
    expect(d.latestHuman?.excerpt).toBe("本当の指示")
    expect(d.lastRow?.interrupted).toBe(true)
  })
})

describe("コンテキスト・状態の手がかり", () => {
  it("最後のメインスレッドの応答の使用量(入力+キャッシュ読み+キャッシュ作成)を使い、サブエージェントと合成行は除く", () => {
    const d = digestOf([
      assistantRow({ input: 100, cacheRead: 5000, cacheCreation: 300, model: "claude-opus-5-5", uuid: "u1" }),
      assistantRow({ input: 999999, sidechain: true }),
      assistantRow({ input: 1, model: "<synthetic>", apiError: true }),
    ])
    expect(d.context).toEqual({ tokens: 5400, model: "claude-opus-5-5" })
    expect(d.model).toBe("claude-opus-5-5")
    expect(d.lastAssistantUuid).toBe("u1")
  })

  it("最後の行の種類と stop_reason を記録する", () => {
    expect(digestOf([humanRow("x")]).lastRow).toMatchObject({ role: "user", stopReason: null })
    expect(digestOf([assistantRow({ stop: "tool_use" })]).lastRow).toMatchObject({ role: "assistant", stopReason: "tool_use" })
    expect(digestOf([assistantRow({ stop: "end_turn" })]).lastRow).toMatchObject({ role: "assistant", stopReason: "end_turn" })
  })

  it("最後の行で呼んだツールの名前と、ツール結果の行がどのツールの結果かを記録する", () => {
    const d = digestOf([
      assistantRow({ stop: "tool_use", tools: [{ name: "Bash", input: { command: "x" }, id: "toolu_a" }, { name: "AskUserQuestion", input: {}, id: "toolu_b" }] }),
    ])
    expect(d.lastRow?.toolNames).toEqual(["Bash", "AskUserQuestion"])
    applyEntry(d, toolResultRow({ toolUseId: "toolu_a" }) as never)
    expect(d.lastRow).toMatchObject({ role: "user", resultOf: "Bash", toolNames: [] })
    applyEntry(d, humanRow("ふつうの入力") as never)
    expect(d.lastRow?.resultOf).toBeNull()
  })

  it("圧縮の直後は、次の応答が来るまで圧縮後のトークン量をコンテキスト量にする", () => {
    const d = digestOf([assistantRow({ input: 1, cacheRead: 700_000, uuid: "a1" })])
    expect(d.context?.tokens).toBe(700_001)
    applyEntry(d, compactRow(tsAt(5)) as never)
    expect(d.context?.tokens).toBe(100)
    applyEntry(d, assistantRow({ input: 50, cacheRead: 150, uuid: "a2" }) as never)
    expect(d.context?.tokens).toBe(200)
  })

  it("圧縮の回数・直近の時刻と、待機中の入力の数を数える", () => {
    const d = digestOf([compactRow(tsAt(1)), compactRow(tsAt(5)), queueRow("enqueue"), queueRow("enqueue"), queueRow("dequeue")])
    expect(d.compactionCount).toBe(2)
    expect(d.lastCompactionAt).toBe(Date.parse(tsAt(5)))
    expect(d.queued).toBe(1)
    expect(digestOf([queueRow("remove")]).queued).toBe(0)
  })

  it("タイトルは custom-title を優先し、ai-title は補助にする", () => {
    const d = digestOf([{ type: "ai-title", aiTitle: "自動の名前" }])
    expect(d.title).toBe("自動の名前")
    applyEntry(d, { type: "custom-title", customTitle: "手動の名前" } as never)
    expect(d.title).toBe("手動の名前")
    applyEntry(d, { type: "ai-title", aiTitle: "後から来た自動の名前" } as never)
    expect(d.title).toBe("手動の名前")
  })
})

describe("タスクリスト(フェーズ)", () => {
  it("items で全体を置き換え、advance で完了と次の開始を進める", () => {
    const d = digestOf([
      planRow({
        items: [
          { content: "調査", status: "in_progress" },
          { content: "実装", status: "pending" },
          { content: "検証", status: "pending" },
        ],
        scope: "first_task",
      }),
    ])
    expect(d.tasks?.map((t) => t.status)).toEqual(["in_progress", "pending", "pending"])
    applyEntry(d, planRow({ advance: true }) as never)
    expect(d.tasks?.map((t) => t.status)).toEqual(["completed", "in_progress", "pending"])
    applyEntry(d, planRow({ advance: true }) as never)
    applyEntry(d, planRow({ advance: true }) as never)
    expect(d.tasks?.map((t) => t.status)).toEqual(["completed", "completed", "completed"])
  })

  it("done / start は1から数えた番号で指定する", () => {
    const d = digestOf([
      planRow({ items: [{ content: "a", status: "in_progress" }, { content: "b", status: "pending" }, { content: "c", status: "pending" }] }),
      planRow({ done: [1], start: 3 }),
    ])
    expect(d.tasks?.map((t) => t.status)).toEqual(["completed", "pending", "in_progress"])
  })

  it("ステップ名は80文字に切り詰める", () => {
    const d = digestOf([planRow({ items: [{ content: "長".repeat(200), status: "pending" }] })])
    expect(d.tasks?.[0].content).toBe(`${"長".repeat(80)}…`)
  })

  it("リストが無い状態の advance は何もしない", () => {
    expect(digestOf([planRow({ advance: true })]).tasks).toBeNull()
  })

  it("サブエージェントのタスク操作は反映しない", () => {
    expect(digestOf([planRow({ items: [{ content: "x", status: "pending" }] }, { sidechain: true })]).tasks).toBeNull()
  })

  it("以前のCLIのタスク(TaskCreate/TaskUpdate)を扱い、前の計画が全完了なら作り直す", () => {
    const create = (subject: string) =>
      assistantRow({ stop: "tool_use", tools: [{ name: "TaskCreate", input: { subject, description: "d", activeForm: "f" } }] })
    const update = (input: Record<string, unknown>) =>
      assistantRow({ stop: "tool_use", tools: [{ name: "TaskUpdate", input }] })

    const d = digestOf([create("一"), create("二"), update({ taskId: "1", status: "completed" }), update({ task_id: "2", status: "in_progress" })])
    expect(d.tasks?.map((t) => [t.content, t.status])).toEqual([
      ["一", "completed"],
      ["二", "in_progress"],
    ])
    applyEntry(d, update({ taskId: "2", status: "completed" }) as never)
    applyEntry(d, create("三") as never)
    expect(d.tasks?.map((t) => t.content)).toEqual(["三"])
    // 新しい一覧のIDは1から始まる
    expect(d.tasks?.[0].id).toBe("1")
    applyEntry(d, update({ taskId: "1", status: "deleted" }) as never)
    expect(d.tasks).toEqual([])
  })

  it("wrap_up を呼んだら、完了していないステップをすべて完了にする(その後に update_plan は来ない)", () => {
    const d = digestOf([
      planRow({ items: [{ content: "a", status: "completed" }, { content: "b", status: "in_progress" }, { content: "c", status: "pending" }] }),
    ])
    expect(d.tasks?.map((t) => t.status)).toEqual(["completed", "in_progress", "pending"])
    applyEntry(d, assistantRow({ stop: "tool_use", tools: [{ name: WRAP_UP_TOOL, input: { recap: "終わりました" } }] }) as never)
    expect(d.tasks?.map((t) => t.status)).toEqual(["completed", "completed", "completed"])
  })

  it("wrap_up はタスクリストが無くても何も起こさず、サブエージェントの wrap_up は反映しない", () => {
    const wrap = (o = {}) => assistantRow({ stop: "tool_use", tools: [{ name: WRAP_UP_TOOL, input: { recap: "x" } }], ...o })
    expect(() => digestOf([wrap()])).not.toThrow()
    expect(digestOf([wrap()]).tasks).toBeNull()
    const d = digestOf([planRow({ items: [{ content: "a", status: "in_progress" }] }), wrap({ sidechain: true })])
    expect(d.tasks?.[0].status).toBe("in_progress")
  })

  it("旧CLIのタスクIDは、ツール結果の「Task #N created」で確定する(新しい一覧でIDが1に戻っても追従する)", () => {
    const create = (subject: string, id: string) =>
      assistantRow({ stop: "tool_use", tools: [{ name: "TaskCreate", input: { subject, description: "d", activeForm: "f" }, id }] })
    const created = (id: string, n: number, subject: string) =>
      toolResultRow({ toolUseId: id, text: `Task #${n} created successfully: ${subject}` })
    const update = (taskId: string, status: string) =>
      assistantRow({ stop: "tool_use", tools: [{ name: "TaskUpdate", input: { taskId, status }, id: `toolu_u${taskId}${status}` }] })

    const d = digestOf([
      // 1つ目の一覧(ID 1,2)
      create("一", "toolu_c1"), created("toolu_c1", 1, "一"),
      create("二", "toolu_c2"), created("toolu_c2", 2, "二"),
      update("1", "completed"), update("2", "completed"),
      // 全完了のあとの新しい一覧は、IDが1から始まる
      create("新一", "toolu_c3"), created("toolu_c3", 1, "新一"),
      create("新二", "toolu_c4"), created("toolu_c4", 2, "新二"),
      update("1", "completed"), update("2", "in_progress"),
    ])
    expect(d.tasks?.map((t) => [t.id, t.content, t.status])).toEqual([
      ["1", "新一", "completed"],
      ["2", "新二", "in_progress"],
    ])
  })

  it("ツール結果のIDが仮の番号とずれていても、結果の番号を優先する", () => {
    const d = digestOf([
      assistantRow({ stop: "tool_use", tools: [{ name: "TaskCreate", input: { subject: "ずれたタスク" }, id: "toolu_x" }] }),
      toolResultRow({ toolUseId: "toolu_x", text: "Task #7 created successfully: ずれたタスク" }),
      assistantRow({ stop: "tool_use", tools: [{ name: "TaskUpdate", input: { taskId: "7", status: "in_progress" } }] }),
      assistantRow({ stop: "tool_use", tools: [{ name: "TaskCreate", input: { subject: "次" }, id: "toolu_y" }] }),
    ])
    expect(d.tasks?.map((t) => [t.id, t.status])).toEqual([["7", "in_progress"], ["8", "pending"]])
  })

  it("結果の行が来ていなくても(末尾だけの読み取り等)、一覧を作り直すときは仮の番号を1に戻す", () => {
    const create = (subject: string) => assistantRow({ stop: "tool_use", tools: [{ name: "TaskCreate", input: { subject } }] })
    const update = (taskId: string, status: string) => assistantRow({ stop: "tool_use", tools: [{ name: "TaskUpdate", input: { taskId, status } }] })
    const d = digestOf([create("一"), create("二"), update("1", "completed"), update("2", "completed"), create("新一"), update("1", "in_progress")])
    expect(d.tasks?.map((t) => [t.id, t.content, t.status])).toEqual([["1", "新一", "in_progress"]])
  })

  it("task_reminder の内容でタスクリストを同期する(空の通知は無視)", () => {
    const d = digestOf([
      planRow({ items: [{ content: "古い", status: "pending" }] }),
      { type: "attachment", attachment: { type: "task_reminder", content: [], itemCount: 0 } },
    ])
    expect(d.tasks?.map((t) => t.content)).toEqual(["古い"])
    applyEntry(d, {
      type: "attachment",
      attachment: { type: "task_reminder", content: [{ id: 1, subject: "新しい", status: "in_progress" }] },
    } as never)
    expect(d.tasks?.map((t) => [t.content, t.status])).toEqual([["新しい", "in_progress"]])
  })
})

describe("applyLine", () => {
  it("キーの後に空白がある形式のJSONも読める", () => {
    const d = createDigest()
    applyLine(d, JSON.stringify(humanRow("空白あり"), null, 0).replace(/":/g, '": '))
    expect(d.latestHuman?.excerpt).toBe("空白あり")
  })

  it("壊れた行・無関係な行は読み飛ばし、例外を投げない", () => {
    const d = createDigest()
    expect(() => applyLine(d, "{broken json")).not.toThrow()
    expect(() => applyLine(d, JSON.stringify({ type: "file-history-snapshot", x: 1 }))).not.toThrow()
    expect(d.lastEventAt).toBeNull()
  })
})

describe("ファイル読み取り", () => {
  const rows = [
    humanRow("最初の指示", { ts: tsAt(1) }),
    compactRow(tsAt(2)),
    planRow({ items: [{ content: "a", status: "in_progress" }, { content: "b", status: "pending" }] }, { ts: tsAt(3) }),
    assistantRow({ input: 10, cacheRead: 40000, ts: tsAt(4), uuid: "last-1" }),
    humanRow("二つ目の指示", { ts: tsAt(5) }),
  ]

  it("全体を読むと、圧縮の回数・タスクリスト・最新の指示がそろい、完全な要約になる", async () => {
    const file = await tmpFile(toJsonl(rows))
    const size = (await fs.stat(file)).size
    const d = createDigest()
    await advanceDigest(file, d, size)
    expect(d.complete).toBe(true)
    expect(d.offset).toBe(size)
    expect(d.compactionCount).toBe(1)
    expect(d.tasks).toHaveLength(2)
    expect(d.latestHuman?.excerpt).toBe("二つ目の指示")
    expect(d.context?.tokens).toBe(40010)
  })

  it("末尾だけの暫定の要約は、先頭の情報(圧縮の回数・タスクリスト)を欠き、complete は false", async () => {
    const padding = Array.from({ length: 200 }, (_, i) => assistantRow({ text: "x".repeat(200), ts: tsAt(10 + i) }))
    const file = await tmpFile(toJsonl([...rows.slice(0, 3), ...padding, rows[3], rows[4]]))
    const size = (await fs.stat(file)).size
    const d = await readTailDigest(file, size, 4096)
    expect(d.complete).toBe(false)
    expect(d.compactionCount).toBe(0)
    expect(d.tasks).toBeNull()
    expect(d.latestHuman?.excerpt).toBe("二つ目の指示")
    expect(d.context?.tokens).toBe(40010)
  })

  it("追記分だけを読み足せる。改行で終わっていない最後の行は次回に回す", async () => {
    const file = await tmpFile(toJsonl(rows))
    const d = createDigest()
    await advanceDigest(file, d, (await fs.stat(file)).size)
    const before = d.offset

    const partial = JSON.stringify(humanRow("三つ目の指示", { ts: tsAt(9) }))
    await fs.appendFile(file, partial.slice(0, 20), "utf-8")
    await advanceDigest(file, d, (await fs.stat(file)).size)
    expect(d.offset).toBe(before)
    expect(d.latestHuman?.excerpt).toBe("二つ目の指示")

    await fs.appendFile(file, partial.slice(20) + "\n", "utf-8")
    await advanceDigest(file, d, (await fs.stat(file)).size)
    expect(d.latestHuman?.excerpt).toBe("三つ目の指示")
    expect(d.compactionCount).toBe(1)
    expect(d.offset).toBeGreaterThan(before)
  })

  it("チャンク境界が日本語の途中・行の途中にあっても正しく読める", async () => {
    const file = await tmpFile(toJsonl(rows))
    const d = createDigest()
    await advanceDigest(file, d, (await fs.stat(file)).size, 7)
    expect(d.latestHuman?.excerpt).toBe("二つ目の指示")
    expect(d.compactionCount).toBe(1)
    expect(d.tasks).toHaveLength(2)
  })

  it("空ファイルでも例外を投げない", async () => {
    const file = await tmpFile("")
    const tail = await readTailDigest(file, 0)
    expect(tail.lastRow).toBeNull()
    const d = createDigest()
    await advanceDigest(file, d, 0)
    expect(d.complete).toBe(true)
  })
})
