import { describe, expect, it } from "vitest"
import { isProblem, parseMap, type MapIndex } from "./mapData"
import { ENTRY_DESKTOP, GUARD_BOX, RouteBuilder, acceptLine, boxOf, entryOf, feedLine, groupOf, startsInstruction } from "./routeRules"

const HOME = "C:\\Users\\tester"
const MARK = "ZZ_SECRET_MARK_7f3"

/** 規則の試験用の地図(箱は id だけが要る) */
function index(): MapIndex {
  const ids = [
    "entry:desktop",
    "task:daily-check",
    GUARD_BOX,
    "group:■試験",
    "skill:report-style",
    "agent:search-helper",
    "mcp:notebooklm-mcp",
    "tool:browser",
    "tool:plugins",
    "tool:cc-shell",
    "tool:cc-edit",
    "tool:cc-web",
    "tool:cc-comms",
    "kn:plan",
    "out:office",
    "out:page",
    "out:commit",
    "out:report",
  ]
  const layerOf = (id: string) =>
    id.startsWith("entry") || id.startsWith("task") ? "entry" : id.startsWith("safety") ? "safety" : id.startsWith("group") ? "routing" : id.startsWith("skill") || id.startsWith("agent") ? "skills" : id.startsWith("kn") ? "knowledge" : id.startsWith("out") ? "output" : "tools"
  const nodes: Record<string, unknown>[] = ids.map((id) => ({ id, layer: layerOf(id), label: id, kind: "", strength: "none", place: "", desc: "" }))
  nodes.find((n) => n.id === "kn:plan")!.place = "~\\Projects\\App\\docs"
  nodes.find((n) => n.id === "group:■試験")!.sessions = [
    { title: "01_試験の担当", folder: "C:\\Work\\App", role: "担当" },
    { title: "02_ほか", folder: "~\\Shared", role: "担当" },
  ]
  const raw = {
    schema: 1,
    layers: ["entry", "safety", "routing", "skills", "tools", "knowledge", "output"].map((id) => ({ id, label: id })),
    nodes,
    edges: [],
  }
  const r = parseMap(raw, HOME, 0)
  if (isProblem(r)) throw new Error(r.message)
  return r.index
}

const IDX = index()
const box = (name: string, input: Record<string, unknown> = {}) => {
  const r = boxOf(name, input, IDX, HOME)
  return r.kind === "box" ? r.id : r.kind === "other" ? `ほか:${r.name}` : "数えない"
}

describe("[A5] 規則3〜12 の写し", () => {
  it("当てる順と箱", () => {
    expect(box("Read", { file_path: "C:\\Users\\tester\\Projects\\App\\docs\\plan.md" })).toBe("kn:plan") // 6
    expect(box("Edit", { file_path: "c:/users/tester/projects/app/docs/x.md" })).toBe("kn:plan") // 6(区切りと大文字小文字)
    expect(box("Read", { file_path: "C:\\Users\\tester\\Projects\\App\\docsX\\plan.md" })).toBe("ほか:Read") // 同じか、その中だけ
    expect(box("Write", { file_path: "C:\\out\\報告.docx" })).toBe("out:office") // 8
    expect(box("Artifact", { action: "publish" })).toBe("out:page")
    expect(box("Artifact", { action: "read" })).toBe("ほか:Artifact")
    expect(box("Bash", { command: "git -C /c/x commit -m test" })).toBe("out:commit")
    expect(box("SendMessage", { message: "[完了] 済み" })).toBe("out:report")
    expect(box("SendMessage", { message: "[報告] 途中" })).toBe("tool:cc-comms") // 10
    expect(box("Skill", { skill: "report-style" })).toBe("skill:report-style") // 3
    expect(box("Skill", { skill: "anthropic-skills:pdf" })).toBe("tool:plugins")
    expect(box("Skill", { skill: "unknown" })).toBe("ほか:Skill")
    expect(box("Agent", { subagent_type: "search-helper" })).toBe("agent:search-helper") // 4
    expect(box("Agent", { subagent_type: "general-purpose" })).toBe("ほか:Agent")
    expect(box("mcp__notebooklm-mcp__notebook_list")).toBe("mcp:notebooklm-mcp") // 5
    expect(box("mcp__Claude_Browser__navigate")).toBe("tool:browser")
    expect(box("mcp__claude-in-chrome__computer")).toBe("tool:browser")
    expect(box("mcp__other__x")).toBe("ほか:mcp__other__x")
    expect(box("Bash", { command: "ls" })).toBe("tool:cc-shell") // 10
    expect(box("PowerShell", { command: "ls" })).toBe("tool:cc-shell")
    expect(box("mcp__terminal__run_in_terminal")).toBe("tool:cc-shell")
    expect(box("mcp__terminal__read_terminal")).toBe("ほか:mcp__terminal__read_terminal")
    expect(box("Skill", { command: "report-style" })).toBe("skill:report-style")
    expect(box("Edit", { file_path: "C:\\else\\a.ts" })).toBe("tool:cc-edit")
    expect(box("WebFetch")).toBe("tool:cc-web")
    expect(box("mcp__ccd_session__start_session")).toBe("tool:cc-comms")
    expect(box("Grep")).toBe("ほか:Grep") // 9
    for (const n of ["ToolSearch", "TaskCreate", "mcp__ccd_turn__x", "mcp__ccd_view__show_pane", "mcp__ccd_session__mark_chapter"]) {
      expect(box(n)).toBe("数えない") // 11
    }
  })
})

/** 合成の会話記録の行 */
let t = Date.UTC(2026, 10, 18, 0, 0)
const ts = () => new Date((t += 1000)).toISOString()
const human = (text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "user", timestamp: ts(), message: { role: "user", content: text }, ...extra })
let toolId = 0
const tool = (name: string, input: Record<string, unknown> = {}, id = `toolu_${++toolId}`) =>
  JSON.stringify({ type: "assistant", timestamp: ts(), message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } })
const result = (text: string) =>
  JSON.stringify({ type: "user", timestamp: ts(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: text }] } })

function run(lines: string[], ctx: Partial<{ entry: string; group: string | null }> = {}, running = false) {
  const b = new RouteBuilder({ index: IDX, home: HOME, entry: ctx.entry ?? ENTRY_DESKTOP, group: ctx.group === undefined ? "group:■試験" : ctx.group })
  for (const l of lines) feedLine(b, l)
  return b.finish(running)
}

describe("[A5] 続く同じ箱をまとめる・初めて通った順・見張りの印", () => {
  it("同じ道具が30回続いても1歩、戻ると番号は同じで visits が増える", () => {
    const lines = [human(`作って ${MARK}`)]
    for (let i = 0; i < 30; i++) lines.push(tool("Bash", { command: `echo ${MARK}` }), result(MARK))
    lines.push(tool("Edit", { file_path: "C:\\else\\a.ts", old_string: MARK }))
    lines.push(tool("Bash", { command: "ls" }))
    lines.push(tool("Read", { file_path: "C:\\else\\b.ts" }), tool("Grep", { pattern: MARK }))
    lines.push(tool("SendMessage", { message: "[完了] x" }))
    const [ins] = run(lines)
    expect(ins.calls).toBe(35)
    expect(ins.steps.map((s) => s.box)).toEqual(["entry:desktop", "group:■試験", "tool:cc-shell", "tool:cc-edit", "tool:cc-shell", "out:report"])
    expect(ins.steps[2].calls).toBe(30)
    expect(ins.visits.map((v) => [v.box, v.order, v.visits])).toEqual([
      ["entry:desktop", 1, 1],
      ["group:■試験", 2, 1],
      ["tool:cc-shell", 3, 2],
      ["tool:cc-edit", 4, 1],
      ["out:report", 5, 1],
    ])
    expect(ins.visits.find((v) => v.box === "tool:cc-shell")?.calls).toBe(31)
    expect(ins.others).toEqual([
      { key: "Grep", isBox: false, count: 1 },
      { key: "Read", isBox: false, count: 1 },
    ])
    // 見張りのフック:Bash 31・Read 1・Grep 1(歩にしない)
    expect(ins.guard).toBe(33)
    expect(ins.steps.some((s) => s.box === GUARD_BOX)).toBe(false)
    expect(ins.top[0]).toEqual({ key: "tool:cc-shell", isBox: true, count: 31 })
  })

  it("[A28] 1つの箱に番号は1つ(道具500回の指示でも、番号は箱の種類の数まで)", () => {
    const lines = [human("長い")]
    for (let i = 0; i < 250; i++) lines.push(tool("Bash", { command: "x" }), tool("Edit", { file_path: "C:\\x\\y.ts" }))
    const [ins] = run(lines)
    expect(ins.calls).toBe(500)
    expect(ins.steps.length).toBe(2 + 500)
    expect(ins.visits).toHaveLength(4)
    expect(new Set(ins.visits.map((v) => v.order)).size).toBe(4)
    expect(ins.visits.find((v) => v.box === "tool:cc-shell")?.visits).toBe(250)
  })
})

describe("[A5] 同じ呼び出しの重なりと、行の絞り", () => {
  it("同じ tool_use の id が2行に出ても1回", () => {
    const r = run([human("x"), tool("Bash", {}, "dup1"), tool("Bash", {}, "dup1"), tool("Edit", { file_path: "C:\\x\\a.ts" })])
    expect(r[0].calls).toBe(2)
    expect(r[0].steps.find((s) => s.box === "tool:cc-shell")?.calls).toBe(1)
  })
  it("acceptLine:道具の呼び出し・人の入力の候補・作業中の入力だけを拾い、ツールの結果の行は拾わない", () => {
    const acc = (l: string) => acceptLine(Buffer.from(l))
    expect(acc(tool("Bash"))).toBe(true)
    expect(acc(human("x"))).toBe(true)
    expect(acc(JSON.stringify({ parentUuid: "a", type: "user", message: { content: "x" } }))).toBe(true)
    expect(acc(result("y"))).toBe(false)
    expect(acc(JSON.stringify({ type: "attachment", attachment: { type: "queued_command" } }))).toBe(true)
    expect(acc(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "z" }] } }))).toBe(true)
    expect(acc(JSON.stringify({ type: "system", subtype: "x" }))).toBe(false)
  })
})

describe("[A6] 指示の区切り", () => {
  it("ツールの結果・他のセッションからの知らせ・isMeta・要約・差し込み・中断は区切りにしない", () => {
    const lines = [
      human("1つ目"),
      tool("Bash"),
      result("結果"),
      human("<cross-session-message from=x>知らせ</cross-session-message>", { isMeta: true, origin: { kind: "peer" } }),
      human("要約", { isCompactSummary: true }),
      human("<system-reminder>x</system-reminder>"),
      human("This session is being continued from a previous conversation ..."),
      human("[Request interrupted by user for tool use]"),
      JSON.stringify({ type: "user", isMeta: true, timestamp: ts(), message: { content: "meta" } }),
      tool("Edit", { file_path: "C:\\x\\a.ts" }),
      human("2つ目"),
      tool("WebFetch"),
      JSON.stringify({ type: "attachment", timestamp: ts(), attachment: { type: "queued_command", prompt: "作業中の人の入力", origin: { kind: "human" } } }),
      tool("Bash"),
    ]
    const r = run(lines)
    expect(r.map((i) => i.calls)).toEqual([2, 1, 1])
  })

  it("予定タスクの最初の入力は1つ目の指示", () => {
    const r = run([human("予定タスクの指示", { turnOrigin: "scheduled" }), tool("Bash")], { entry: "task:daily-check" })
    expect(r).toHaveLength(1)
    expect(r[0].steps[0].box).toBe("task:daily-check")
  })

  it("サブエージェントの行(isSidechain)は読まない [A5d]", () => {
    const side = JSON.stringify({ type: "assistant", isSidechain: true, timestamp: ts(), message: { content: [{ type: "tool_use", name: "Bash", input: {} }] } })
    const r = run([human("x"), tool("Agent", { subagent_type: "search-helper", prompt: MARK }), side])
    expect(r[0].calls).toBe(1)
    expect(r[0].agents).toBe(1)
    expect(r[0].steps.map((s) => s.box)).toContain("agent:search-helper")
  })

  it("startsInstruction は人の入力の行だけ", () => {
    expect(startsInstruction({ type: "user", message: { content: "x" } })).toBe(true)
    expect(startsInstruction({ type: "user", message: { content: "x" }, isSidechain: true })).toBe(false)
    expect(startsInstruction({ type: "assistant", message: { content: "x" } })).toBe(false)
  })
})

describe("[低7・低8・低10] 最初の入力の前・時刻・地図に無い入口", () => {
  it("最初の人の入力より前の道具は番号0 にまとめ、後の指示は1から", () => {
    const r = run([tool("Bash"), tool("Edit", { file_path: "C:\\x\\a.ts" }), human("1つ目"), tool("Bash")])
    expect(r.map((i) => [i.index, i.calls])).toEqual([
      [0, 2],
      [1, 1],
    ])
  })
  it("道具を呼ばない assistant の行も、指示の終わりの時刻に入る(acceptLine を通す)", () => {
    const b = new RouteBuilder({ index: IDX, home: HOME, entry: ENTRY_DESKTOP, group: null })
    const lines = [human("a"), tool("Bash"), JSON.stringify({ type: "assistant", timestamp: "2026-11-18T09:00:00.000Z", message: { content: [{ type: "text", text: "おわり" }] } })]
    for (const l of lines) if (acceptLine(Buffer.from(l))) feedLine(b, l)
    expect(b.finish(false)[0].endAt).toBe(Date.parse("2026-11-18T09:00:00.000Z"))
  })
  it("入口・グループの箱が地図に無いときは歩に入れない", () => {
    const r = run([human("a"), tool("Bash")], { entry: "entry:none", group: "group:none" })
    expect(r[0].steps.map((s) => s.box)).toEqual(["tool:cc-shell"])
  })
})

describe("[A25] 空の状態", () => {
  it("道具0回・箱を通らない・グループ不明", () => {
    const r = run([human("a"), human("b"), tool("Read", { file_path: "C:\\x" }), tool("Grep")], { group: null })
    expect(r[0].empty).toBe("no-tools")
    expect(r[1].empty).toBe("no-box")
    expect(r[1].steps.map((s) => s.box)).toEqual(["entry:desktop"])
    expect(r[1].visits).toHaveLength(1)
  })
  it("動いている途中は最後の指示だけ", () => {
    const r = run([human("a"), human("b")], {}, true)
    expect(r.map((i) => i.running)).toEqual([false, true])
  })
})

describe("[A8] 中身を出さない", () => {
  it("人の入力・ファイルの中身・コマンド・ツールの入力・ファイルのパスが結果に0件", () => {
    const lines = [
      human(`指示 ${MARK}`),
      tool("Bash", { command: `cat ${MARK}` }),
      result(`出力 ${MARK}`),
      tool("Write", { file_path: `C:\\x\\${MARK}.ts`, content: MARK }),
      tool("Read", { file_path: `C:\\Users\\tester\\Projects\\App\\docs\\${MARK}.md` }),
      tool("SendMessage", { message: `[完了] ${MARK}` }),
    ]
    const text = JSON.stringify(run(lines))
    expect(text).not.toContain(MARK)
    expect(text).not.toContain("C:\\\\")
  })
  it("巨大なツールの結果の行は解かずに時刻だけ進める", () => {
    const big = result("x".repeat(1100 * 1024))
    const r = run([human("a"), tool("Bash"), big])
    expect(r[0].calls).toBe(1)
    expect(r[0].endAt).not.toBeNull()
  })
})

describe("[A5b] 入口とグループ", () => {
  it("題名・フォルダ・~ 戻し・不一致", () => {
    expect(groupOf("01_試験の担当", null, IDX, HOME)).toBe("group:■試験")
    expect(groupOf("別の題名", "c:/work/app/", IDX, HOME)).toBe("group:■試験")
    expect(groupOf("別の題名", "C:\\Users\\tester\\Shared", IDX, HOME)).toBe("group:■試験")
    expect(groupOf("別の題名", "C:\\Other", IDX, HOME)).toBeNull()
  })
  it("予定タスクは task:<id>(地図に無ければ entry:desktop)", () => {
    expect(entryOf("daily-check", IDX)).toBe("task:daily-check")
    expect(entryOf("nothing", IDX)).toBe("entry:desktop")
    expect(entryOf(null, IDX)).toBe("entry:desktop")
  })
})
