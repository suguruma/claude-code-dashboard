import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { deleteExecutionLog, getExecutionLogs, readExecutionLogs, saveSuggestedRulesFromLog } from "./executionLog"
import { getRules } from "./rules"
import { ProjectConfig } from "./types"

const cleanupDirs: string[] = []

async function makeProject(): Promise<ProjectConfig> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-test-"))
  cleanupDirs.push(tmpDir)
  return { id: "test", name: "test", path: tmpDir }
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("getExecutionLogs 後方互換読み込み", () => {
  it("{ logs: [...] } 形式（正式スキーマ）を読み込める", async () => {
    const project = await makeProject()
    await fs.writeFile(
      path.join(project.path, "execution_log.json"),
      JSON.stringify({ logs: [{ task_id: "t1" }] })
    )
    const logs = await getExecutionLogs(project)
    expect(logs).toHaveLength(1)
    expect(logs[0].task_id).toBe("t1")
  })

  it("仕様書どおりの単一オブジェクト形式も自動で配列にラップする", async () => {
    const project = await makeProject()
    await fs.writeFile(
      path.join(project.path, "execution_log.json"),
      JSON.stringify({ task_id: "t1", task_name: "legacy" })
    )
    const logs = await getExecutionLogs(project)
    expect(logs).toHaveLength(1)
    expect(logs[0].task_name).toBe("legacy")
  })

  it("生の配列形式も読み込める", async () => {
    const project = await makeProject()
    await fs.writeFile(
      path.join(project.path, "execution_log.json"),
      JSON.stringify([{ task_id: "t1" }, { task_id: "t2" }])
    )
    const logs = await getExecutionLogs(project)
    expect(logs).toHaveLength(2)
  })

  it("ファイルが存在しない場合は空配列を返す", async () => {
    const project = await makeProject()
    const logs = await getExecutionLogs(project)
    expect(logs).toEqual([])
  })

  it("assigned_agents / trial_process / status / chain_of_command（マルチエージェント可視化用の新規フィールド）を保持する", async () => {
    const project = await makeProject()
    await fs.writeFile(
      path.join(project.path, "execution_log.json"),
      JSON.stringify({
        logs: [
          {
            task_id: "t1",
            status: "completed",
            agents_discussion: {
              consensus_rate: 90,
              conflict_point: "なし",
              trade_offs: [],
              assigned_agents: [{ role: "検証者", reason_for_assignment: "ハルシネーション防止" }],
              trial_process: [{ step: 1, action: "検索", result: "error", note: "出典が古い" }],
              chain_of_command: ["オーナー", "AI社長（メインディレクター）"],
            },
          },
        ],
      })
    )
    const logs = await getExecutionLogs(project)
    expect(logs[0].status).toBe("completed")
    expect(logs[0].agents_discussion?.assigned_agents).toEqual([
      { role: "検証者", reason_for_assignment: "ハルシネーション防止" },
    ])
    expect(logs[0].agents_discussion?.trial_process).toEqual([
      { step: 1, action: "検索", result: "error", note: "出典が古い" },
    ])
    expect(logs[0].agents_discussion?.chain_of_command).toEqual(["オーナー", "AI社長（メインディレクター）"])
  })

  it("chain_of_commandが無い場合は指揮系統なしのフラットなチームとして扱える", async () => {
    const project = await makeProject()
    await fs.writeFile(
      path.join(project.path, "execution_log.json"),
      JSON.stringify({
        logs: [
          {
            task_id: "t2",
            agents_discussion: {
              consensus_rate: 88,
              conflict_point: "なし",
              trade_offs: [],
              assigned_agents: [
                { role: "戦略家", reason_for_assignment: "市場分析" },
                { role: "設計者", reason_for_assignment: "工程分解" },
              ],
            },
          },
        ],
      })
    )
    const logs = await getExecutionLogs(project)
    expect(logs[0].agents_discussion?.chain_of_command).toBeUndefined()
    expect(logs[0].agents_discussion?.assigned_agents).toHaveLength(2)
  })

  it("persona / memory_context / tools / current_state（エージェントが保持する4種の情報）を保持する", async () => {
    const project = await makeProject()
    await fs.writeFile(
      path.join(project.path, "execution_log.json"),
      JSON.stringify({
        logs: [
          {
            task_id: "t3",
            agents_discussion: {
              consensus_rate: 90,
              conflict_point: "なし",
              trade_offs: [],
              assigned_agents: [
                {
                  role: "戦略家",
                  reason_for_assignment: "市場分析",
                  persona: "論理的かつ厳格に市場性を評価する",
                  memory_context: "docs/plan.mdの過去ラウンドを参照",
                  tools: ["WebSearch", "Read"],
                  current_state: "勝ち筋を1点に絞り込んだ",
                },
              ],
            },
          },
        ],
      })
    )
    const logs = await getExecutionLogs(project)
    const agent = logs[0].agents_discussion?.assigned_agents?.[0]
    expect(agent?.persona).toBe("論理的かつ厳格に市場性を評価する")
    expect(agent?.memory_context).toBe("docs/plan.mdの過去ラウンドを参照")
    expect(agent?.tools).toEqual(["WebSearch", "Read"])
    expect(agent?.current_state).toBe("勝ち筋を1点に絞り込んだ")
  })

  it("これらの新規フィールドが無い旧形式のログもそのまま読み込める（後方互換）", async () => {
    const project = await makeProject()
    await fs.writeFile(
      path.join(project.path, "execution_log.json"),
      JSON.stringify({
        logs: [
          {
            task_id: "t1",
            agents_discussion: { consensus_rate: 80, conflict_point: "", trade_offs: [] },
          },
        ],
      })
    )
    const logs = await getExecutionLogs(project)
    expect(logs[0].status).toBeUndefined()
    expect(logs[0].agents_discussion?.assigned_agents).toBeUndefined()
    expect(logs[0].agents_discussion?.trial_process).toBeUndefined()
  })
})

describe("saveSuggestedRulesFromLog", () => {
  it("指定タスクの suggested_new_rules を CLAUDE.md に追加する", async () => {
    const project = await makeProject()
    await fs.writeFile(
      path.join(project.path, "execution_log.json"),
      JSON.stringify({
        logs: [
          {
            task_id: "t1",
            task_name: "サンプルタスク",
            executed_at: "2026-01-01",
            one_shot_score: 80,
            summary: "",
            agents_discussion: { consensus_rate: 80, conflict_point: "", trade_offs: [] },
            user_interventions: [],
            next_golden_prompt: "",
            suggested_new_rules: [{ category: "フォーマット", content: "表形式にする" }],
          },
        ],
      })
    )
    await fs.writeFile(path.join(project.path, "CLAUDE.md"), "")

    const savedCount = await saveSuggestedRulesFromLog(project, project, "t1")
    expect(savedCount).toBe(1)

    const rules = await getRules(project)
    expect(rules).toHaveLength(1)
    expect(rules[0].content).toBe("表形式にする")
  })

  it("存在しない task_id を指定するとエラーになる", async () => {
    const project = await makeProject()
    await fs.writeFile(path.join(project.path, "execution_log.json"), JSON.stringify({ logs: [] }))
    await expect(saveSuggestedRulesFromLog(project, project, "unknown")).rejects.toThrow()
  })

  it("読み込み元と書き込み先が別プロジェクトの場合、ルールは書き込み先にのみ追加される", async () => {
    const sourceProject = await makeProject()
    const targetProject = await makeProject()
    await fs.writeFile(
      path.join(sourceProject.path, "execution_log.json"),
      JSON.stringify({
        logs: [
          {
            task_id: "t1",
            task_name: "サンプルタスク",
            executed_at: "2026-01-01",
            one_shot_score: 80,
            summary: "",
            agents_discussion: { consensus_rate: 80, conflict_point: "", trade_offs: [] },
            user_interventions: [],
            next_golden_prompt: "",
            suggested_new_rules: [{ category: "フォーマット", content: "表形式にする" }],
          },
        ],
      })
    )
    await fs.writeFile(path.join(sourceProject.path, "CLAUDE.md"), "")
    await fs.writeFile(path.join(targetProject.path, "CLAUDE.md"), "")

    const savedCount = await saveSuggestedRulesFromLog(sourceProject, targetProject, "t1")
    expect(savedCount).toBe(1)

    expect(await getRules(sourceProject)).toHaveLength(0)
    const targetRules = await getRules(targetProject)
    expect(targetRules).toHaveLength(1)
    expect(targetRules[0].content).toBe("表形式にする")
  })
})

describe("deleteExecutionLog", () => {
  it("指定したtask_idのエントリのみを削除し、他のエントリは保持する", async () => {
    const project = await makeProject()
    await fs.writeFile(
      path.join(project.path, "execution_log.json"),
      JSON.stringify({ logs: [{ task_id: "t1" }, { task_id: "t2" }] })
    )

    await deleteExecutionLog(project, "t1")

    const logs = await getExecutionLogs(project)
    expect(logs).toHaveLength(1)
    expect(logs[0].task_id).toBe("t2")
  })

  it("単一オブジェクト形式（後方互換の読み込み元）から削除すると、正式スキーマの配列で書き戻される", async () => {
    const project = await makeProject()
    await fs.writeFile(
      path.join(project.path, "execution_log.json"),
      JSON.stringify({ task_id: "t1", task_name: "legacy" })
    )

    await deleteExecutionLog(project, "t1")

    const raw = JSON.parse(await fs.readFile(path.join(project.path, "execution_log.json"), "utf-8"))
    expect(raw).toEqual({ logs: [] })
  })

  it("存在しないtask_idを指定するとエラーになる", async () => {
    const project = await makeProject()
    await fs.writeFile(path.join(project.path, "execution_log.json"), JSON.stringify({ logs: [{ task_id: "t1" }] }))
    await expect(deleteExecutionLog(project, "unknown")).rejects.toThrow()

    const logs = await getExecutionLogs(project)
    expect(logs).toHaveLength(1)
  })

  it("削除の前に、削除前の execution_log.json を .ccd-backup.<epoch> として退避する", async () => {
    const project = await makeProject()
    const original = JSON.stringify({ logs: [{ task_id: "t1" }, { task_id: "t2" }] })
    await fs.writeFile(path.join(project.path, "execution_log.json"), original)

    await deleteExecutionLog(project, "t1")

    const backups = (await fs.readdir(project.path)).filter((f) => f.startsWith("execution_log.json.ccd-backup."))
    expect(backups).toHaveLength(1)
    // 退避は削除前の内容(t1もt2も含む)
    expect(await fs.readFile(path.join(project.path, backups[0]), "utf-8")).toBe(original)
    // 本体からは t1 が消えている
    expect((await getExecutionLogs(project)).map((l) => l.task_id)).toEqual(["t2"])
  })

  it("存在しないtask_idの削除では、退避を作らない(何も書き換えていないため)", async () => {
    const project = await makeProject()
    await fs.writeFile(path.join(project.path, "execution_log.json"), JSON.stringify({ logs: [{ task_id: "t1" }] }))
    await expect(deleteExecutionLog(project, "unknown")).rejects.toThrow()
    const files = await fs.readdir(project.path)
    expect(files.some((f) => f.includes(".ccd-backup."))).toBe(false)
  })
})

describe("欠けた項目のある実行ログ（手書き・他のツールが書いたもの）", () => {
  const complete = {
    task_id: "complete",
    task_name: "通常のログ",
    executed_at: "2026-01-01",
    one_shot_score: 90,
    summary: "s",
    agents_discussion: { consensus_rate: 80, conflict_point: "なし", trade_offs: [] },
    user_interventions: [],
    next_golden_prompt: "p",
    suggested_new_rules: [],
  }

  async function writeLog(project: ProjectConfig, logs: unknown[]) {
    await fs.writeFile(path.join(project.path, "execution_log.json"), JSON.stringify({ logs }, null, 2))
  }

  it("agents_discussion が無いエントリは、議論なしのまま読める（0%や空の議論を作らない）。配列の項目は空になる", async () => {
    const project = await makeProject()
    await writeLog(project, [{ task_id: "no-discussion", task_name: "n", executed_at: "2026-01-01", one_shot_score: 70, summary: "s", next_golden_prompt: "p" }])

    const [entry] = await getExecutionLogs(project)

    expect(entry.agents_discussion).toBeUndefined()
    expect(entry.user_interventions).toEqual([])
    expect(entry.suggested_new_rules).toEqual([])
  })

  it("agents_discussion の中の欠落（空オブジェクト・合意度なし・対立点なし・各配列が無い・型違い）でも、例外が出ない", async () => {
    const project = await makeProject()
    await writeLog(project, [
      { ...complete, task_id: "empty-object", agents_discussion: {} },
      { ...complete, task_id: "no-consensus", agents_discussion: { conflict_point: "x", trade_offs: [] } },
      { ...complete, task_id: "bad-types", agents_discussion: { consensus_rate: "高い", conflict_point: 3, trade_offs: "なし", assigned_agents: {}, trial_process: "x", chain_of_command: 1 } },
      { ...complete, task_id: "null-discussion", agents_discussion: null },
    ])

    const logs = await getExecutionLogs(project)
    const byId = Object.fromEntries(logs.map((l) => [l.task_id, l]))

    expect(logs).toHaveLength(4)
    expect(byId["empty-object"].agents_discussion).toEqual({ trade_offs: [] })
    expect(byId["no-consensus"].agents_discussion?.consensus_rate).toBeUndefined()
    expect(byId["bad-types"].agents_discussion).toEqual({ trade_offs: [] })
    expect(byId["null-discussion"].agents_discussion).toBeUndefined()
  })

  it("user_interventions・suggested_new_rules が配列でないときは空の配列にする。提案ルールの保存も落ちない", async () => {
    const project = await makeProject()
    await writeLog(project, [{ ...complete, task_id: "bad-arrays", user_interventions: "なし", suggested_new_rules: null }])
    await fs.writeFile(path.join(project.path, "CLAUDE.md"), "")

    const [entry] = await getExecutionLogs(project)
    expect(entry.user_interventions).toEqual([])
    expect(entry.suggested_new_rules).toEqual([])
    expect(await saveSuggestedRulesFromLog(project, project, "bad-arrays")).toBe(0)
  })

  it("オブジェクトでない要素・task_id の無い（空・文字列と数値でない）要素は、画面に出さず、その数を skipped で返す。通常のエントリは出る", async () => {
    const project = await makeProject()
    await writeLog(project, [null, "text", 3, [], { task_name: "task_id なし" }, { task_id: "" }, { task_id: {} }, { task_id: null }, { task_id: Number.NaN }, complete])

    expect((await getExecutionLogs(project)).map((l) => l.task_id)).toEqual(["complete"])
    expect(await readExecutionLogs(project)).toMatchObject({ skipped: 9, logs: [{ task_id: "complete" }] })
  })

  it("task_id が数値のエントリは、文字列に直して出す。skipped には数えない。削除もできる", async () => {
    const project = await makeProject()
    const numeric = { task_name: "数値のID", task_id: 5, summary: "s" }
    await writeLog(project, [numeric, complete])

    const result = await readExecutionLogs(project)
    expect(result.skipped).toBe(0)
    expect(result.logs.map((l) => [l.task_id, l.task_name])).toEqual([
      ["5", "数値のID"],
      ["complete", "通常のログ"],
    ])

    await deleteExecutionLog(project, "5")
    const raw = JSON.parse(await fs.readFile(path.join(project.path, "execution_log.json"), "utf-8"))
    expect(raw).toEqual({ logs: [complete] })
  })

  it("表示できない要素があるログから1件を削除しても、表示できない要素はファイルに残る", async () => {
    const project = await makeProject()
    const unreadable = { task_name: "task_id なし" }
    await writeLog(project, [unreadable, complete, { ...complete, task_id: "to-delete" }])

    await deleteExecutionLog(project, "to-delete")

    const raw = JSON.parse(await fs.readFile(path.join(project.path, "execution_log.json"), "utf-8"))
    expect(raw).toEqual({ logs: [unreadable, complete] })
  })

  it("欠落のある別のエントリがあるログから1件を削除しても、残りのエントリは削除前と同じ（項目が加わらない・順序が変わらない）", async () => {
    const project = await makeProject()
    const sparse = { task_id: "sparse", task_name: "欠けたログ" }
    const odd = { task_id: "odd", agents_discussion: { consensus_rate: "高い" }, user_interventions: "なし" }
    const unreadable = { task_name: "task_id なし" }
    await writeLog(project, [sparse, complete, null, odd, unreadable, { ...complete, task_id: "to-delete" }])

    await deleteExecutionLog(project, "to-delete")

    const raw = JSON.parse(await fs.readFile(path.join(project.path, "execution_log.json"), "utf-8"))
    expect(raw).toEqual({ logs: [sparse, complete, null, odd, unreadable] })
  })

  it("単一オブジェクトの形で agents_discussion が無いログも読める", async () => {
    const project = await makeProject()
    await fs.writeFile(path.join(project.path, "execution_log.json"), JSON.stringify({ task_id: "single", task_name: "n" }))

    const [entry] = await getExecutionLogs(project)
    expect(entry.task_id).toBe("single")
    expect(entry.agents_discussion).toBeUndefined()
  })
})
