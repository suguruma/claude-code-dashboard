import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getClaudeProjectsRoot, getSessionMetrics, listSessionProjects, listSessions } from "./sessionMonitor"

const cleanupDirs: string[] = []
let homeDir: string

beforeEach(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-sessionmonitor-home-"))
  cleanupDirs.push(homeDir)
  vi.spyOn(os, "homedir").mockReturnValue(homeDir)
  // 撮影の手順の環境変数(CCD_DESKTOP_AUTODETECT=0)や、データの場所の指定を付けたシェルで流しても、結果が変わらないように外す
  vi.stubEnv("CCD_DESKTOP_AUTODETECT", undefined)
  vi.stubEnv("CLAUDE_DESKTOP_PROJECTS_ROOT", undefined)
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

function line(obj: unknown): string {
  return JSON.stringify(obj) + "\n"
}

async function writeSession(dirName: string, sessionId: string, content: string): Promise<string> {
  const dirPath = path.join(homeDir, ".claude", "projects", dirName)
  await fs.mkdir(dirPath, { recursive: true })
  const filePath = path.join(dirPath, `${sessionId}.jsonl`)
  await fs.writeFile(filePath, content)
  return filePath
}

const SAMPLE_LINES = [
  { type: "user", timestamp: "2026-01-01T00:00:00.000Z", cwd: "C:\\proj", version: "2.1.217", message: { content: "こんにちは" } },
  {
    type: "assistant",
    timestamp: "2026-01-01T00:00:01.000Z",
    effort: "high",
    message: {
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 },
      content: [{ type: "tool_use", id: "toolu_1", name: "Read" }],
    },
  },
  {
    type: "user",
    timestamp: "2026-01-01T00:00:02.000Z",
    message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: false }] },
  },
  {
    type: "assistant",
    timestamp: "2026-01-01T00:00:03.000Z",
    effort: "high",
    message: {
      usage: { input_tokens: 5, output_tokens: 30, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 },
      content: [{ type: "tool_use", id: "toolu_2", name: "Bash" }],
    },
  },
  {
    type: "user",
    timestamp: "2026-01-01T00:00:04.000Z",
    toolUseResult: { stdout: "", stderr: "boom", interrupted: false },
    message: {
      content: [{ type: "tool_result", tool_use_id: "toolu_2", is_error: true }],
    },
  },
  {
    type: "system",
    subtype: "compact_boundary",
    timestamp: "2026-01-01T00:00:05.000Z",
    compactMetadata: { trigger: "auto", preTokens: 500000, durationMs: 1000 },
  },
  {
    type: "system",
    subtype: "stop_hook_summary",
    timestamp: "2026-01-01T00:00:06.000Z",
    hookErrors: ["some hook failed"],
  },
]

describe("listSessionProjects", () => {
  it("~/.claude/projects が無ければ空配列を返す", async () => {
    expect(await listSessionProjects()).toEqual([])
  })

  it(".jsonlを持つディレクトリのみ一覧化する", async () => {
    await writeSession("proj-a", "s1", SAMPLE_LINES.map(line).join(""))
    await fs.mkdir(path.join(homeDir, ".claude", "projects", "empty-dir"), { recursive: true })

    const projects = await listSessionProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0]).toMatchObject({ dirName: "proj-a", sessionCount: 1 })
  })
})

describe("listSessions / getSessionMetrics", () => {
  it("トークン・ツール呼び出し・エラー・コンパクション・フック失敗を正しく集計する", async () => {
    await writeSession("proj-a", "s1", SAMPLE_LINES.map(line).join(""))

    const sessions = await listSessions("proj-a")
    expect(sessions).toHaveLength(1)
    const summary = sessions[0]
    expect(summary.sessionId).toBe("s1")
    expect(summary.turnCount).toBe(2)
    expect(summary.toolCallCount).toBe(2)
    expect(summary.toolErrorCount).toBe(1)
    expect(summary.totalInputTokens).toBe(15)
    expect(summary.totalOutputTokens).toBe(50)
    expect(summary.compactionCount).toBe(1)
    expect(summary.cwd).toBe("C:\\proj")
    expect(summary.version).toBe("2.1.217")
    expect(summary.firstUserMessageExcerpt).toBe("こんにちは")
    expect(summary.skillNames).toEqual([])

    const metrics = await getSessionMetrics("proj-a", "s1")
    expect(metrics.tokenPoints).toHaveLength(2)
    expect(metrics.toolCallCountsByName).toEqual({ Read: 1, Bash: 1 })
    expect(metrics.toolErrorCountsByName).toEqual({ Bash: 1 })
    expect(metrics.effortCounts).toEqual({ high: 2 })
    expect(metrics.compactions).toEqual([
      { timestamp: "2026-01-01T00:00:05.000Z", trigger: "auto", preTokens: 500000, durationMs: 1000 },
    ])
    expect(metrics.hookErrorCount).toBe(1)
    expect(metrics.userMessageCount).toBe(1)
  })

  it("MCPツール呼び出し・スキル呼び出し・サブエージェント呼び出し・出力文字数を集計する", async () => {
    const lines = [
      SAMPLE_LINES[0],
      {
        type: "assistant",
        timestamp: "2026-01-01T00:00:01.000Z",
        message: {
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [
            { type: "tool_use", id: "toolu_mcp", name: "mcp__ccd_session__mark_chapter" },
            { type: "tool_use", id: "toolu_skill", name: "Skill", input: { skill: "task" } },
            {
              type: "tool_use",
              id: "toolu_agent",
              name: "Agent",
              input: { subagent_type: "Explore" },
            },
          ],
        },
      },
      {
        type: "user",
        timestamp: "2026-01-01T00:00:02.000Z",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_mcp",
              is_error: false,
              content: [{ type: "text", text: "0123456789" }],
            },
            { type: "tool_result", tool_use_id: "toolu_skill", is_error: false, content: "ok" },
            { type: "tool_result", tool_use_id: "toolu_agent", is_error: false, content: "done" },
          ],
        },
      },
    ]
    await writeSession("proj-a", "s1", lines.map(line).join(""))
    const metrics = await getSessionMetrics("proj-a", "s1")

    expect(metrics.mcpCallCountsByServer).toEqual({ ccd_session: 1 })
    expect(metrics.skillCallCounts).toEqual({ task: 1 })
    expect(metrics.subagentCallCounts).toEqual({ Explore: 1 })
    expect(metrics.toolOutputCharsByName["mcp__ccd_session__mark_chapter"]).toBe(10)

    expect(metrics.summary.mcpToolCallCount).toBe(1)
    expect(metrics.summary.skillCallCount).toBe(1)
    expect(metrics.summary.totalToolOutputChars).toBe(16)
    expect(metrics.summary.skillNames).toEqual(["task"])
  })

  it("先頭発話が60文字を超える場合は末尾を省略し、tool_result専用行は先頭発話として扱わない", async () => {
    const longText = "あ".repeat(80)
    const lines = [
      {
        type: "user",
        timestamp: "2026-01-01T00:00:00.000Z",
        // tool_resultのみの行はhasToolResult=trueとなり、ユーザーの実発話としてはカウントされない
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_x", is_error: false }] },
      },
      {
        type: "user",
        timestamp: "2026-01-01T00:00:01.000Z",
        message: { content: [{ type: "text", text: longText }] },
      },
    ]
    await writeSession("proj-a", "s1", lines.map(line).join(""))
    const summary = (await listSessions("proj-a"))[0]
    expect(summary.firstUserMessageExcerpt).toBe(`${"あ".repeat(60)}…`)
  })

  it("tool_resultのcontent配列中、type!=='text'のブロックはtextフィールドを持っていても文字数に含めない", async () => {
    const lines = [
      SAMPLE_LINES[0],
      {
        type: "assistant",
        timestamp: "2026-01-01T00:00:01.000Z",
        message: {
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: "tool_use", id: "toolu_img", name: "Read" }],
        },
      },
      {
        type: "user",
        timestamp: "2026-01-01T00:00:02.000Z",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_img",
              is_error: false,
              content: [
                { type: "text", text: "abc" },
                // typeがtext以外だが偶然textという名の文字列フィールドを持つブロック（画像ブロック等を想定）
                { type: "image", text: "should-not-be-counted" },
              ],
            },
          ],
        },
      },
    ]
    await writeSession("proj-a", "s1", lines.map(line).join(""))
    const metrics = await getSessionMetrics("proj-a", "s1")

    expect(metrics.toolOutputCharsByName.Read).toBe(3)
  })

  it("interrupted:trueを正しくカウントする", async () => {
    const lines = [
      SAMPLE_LINES[0],
      SAMPLE_LINES[1],
      {
        type: "user",
        timestamp: "2026-01-01T00:00:02.000Z",
        toolUseResult: { interrupted: true },
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: false }] },
      },
    ]
    await writeSession("proj-a", "s1", lines.map(line).join(""))
    const metrics = await getSessionMetrics("proj-a", "s1")
    expect(metrics.interruptedToolCallCount).toBe(1)
  })

  it("1つの応答が複数行に分かれていても、message.idで1回だけ数える(トークン・ターン数・effortが二重に増えない)", async () => {
    const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 }
    const assistant = (ts: string, id: string, content: unknown, u = usage) => ({
      type: "assistant",
      timestamp: ts,
      effort: "high",
      message: { id, usage: u, content },
    })
    const lines = [
      { type: "user", timestamp: "2026-01-01T00:00:00.000Z", message: { content: "依頼" } },
      // 同じ応答(msg_a)が、思考・本文・ツール呼び出しの3行に分かれている
      assistant("2026-01-01T00:00:01.000Z", "msg_a", [{ type: "thinking", thinking: "" }]),
      assistant("2026-01-01T00:00:01.100Z", "msg_a", [{ type: "text", text: "本文" }]),
      assistant("2026-01-01T00:00:01.200Z", "msg_a", [{ type: "tool_use", id: "toolu_1", name: "Read" }]),
      assistant("2026-01-01T00:00:03.000Z", "msg_b", [{ type: "text", text: "完了" }], { ...usage, output_tokens: 30 }),
    ]
    await writeSession("proj-a", "s1", lines.map(line).join(""))

    const [summary] = await listSessions("proj-a")
    expect(summary.turnCount).toBe(2)
    expect(summary.totalInputTokens).toBe(20)
    expect(summary.totalOutputTokens).toBe(50)
    expect(summary.totalCacheReadTokens).toBe(200)
    expect(summary.totalCacheCreationTokens).toBe(10)
    const metrics = await getSessionMetrics("proj-a", "s1")
    expect(metrics.tokenPoints.map((p) => p.turnIndex)).toEqual([0, 1])
    expect(metrics.effortCounts).toEqual({ high: 2 })
    // ツール呼び出しは、応答の行ごとに別のブロックなので、重複除去の影響を受けない
    expect(metrics.toolCallCountsByName).toEqual({ Read: 1 })
  })

  it("同じ応答でusageが違う行があるときは、出力が最大の行を採る(順序に依存しない)", async () => {
    const row = (id: string, output: number) => ({
      type: "assistant",
      timestamp: "2026-01-01T00:00:01.000Z",
      message: { id, usage: { input_tokens: 1, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [] },
    })
    await writeSession("proj-a", "s1", [row("msg_a", 5), row("msg_a", 90), row("msg_a", 40)].map(line).join(""))
    const [summary] = await listSessions("proj-a")
    expect(summary.totalOutputTokens).toBe(90)
    expect(summary.turnCount).toBe(1)
  })

  it("message.idの無い行は、重複除去せず従来どおり1行ずつ数える", async () => {
    const row = {
      type: "assistant",
      timestamp: "2026-01-01T00:00:01.000Z",
      message: { usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [] },
    }
    await writeSession("proj-a", "s1", [row, row].map(line).join(""))
    const [summary] = await listSessions("proj-a")
    expect(summary.turnCount).toBe(2)
    expect(summary.totalOutputTokens).toBe(4)
  })

  it("壊れたJSON行は無視して継続する", async () => {
    const content = line(SAMPLE_LINES[0]) + "not valid json\n" + line(SAMPLE_LINES[1])
    await writeSession("proj-a", "s1", content)
    const metrics = await getSessionMetrics("proj-a", "s1")
    expect(metrics.tokenPoints).toHaveLength(1)
  })

  it("存在しないセッションはエラーになる", async () => {
    await expect(getSessionMetrics("proj-a", "unknown")).rejects.toThrow()
  })

  it("セッションが無いプロジェクトは空配列を返す", async () => {
    expect(await listSessions("no-such-project")).toEqual([])
  })
})

describe("getClaudeProjectsRoot", () => {
  it("homedir配下の.claude/projectsを指す", () => {
    expect(getClaudeProjectsRoot()).toBe(path.join(homeDir, ".claude", "projects"))
  })
})
