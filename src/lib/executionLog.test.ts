import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { getExecutionLogs, saveSuggestedRulesFromLog } from "./executionLog"
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
    expect(logs[0].agents_discussion.assigned_agents).toEqual([
      { role: "検証者", reason_for_assignment: "ハルシネーション防止" },
    ])
    expect(logs[0].agents_discussion.trial_process).toEqual([
      { step: 1, action: "検索", result: "error", note: "出典が古い" },
    ])
    expect(logs[0].agents_discussion.chain_of_command).toEqual(["オーナー", "AI社長（メインディレクター）"])
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
    expect(logs[0].agents_discussion.chain_of_command).toBeUndefined()
    expect(logs[0].agents_discussion.assigned_agents).toHaveLength(2)
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
    const agent = logs[0].agents_discussion.assigned_agents?.[0]
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
    expect(logs[0].agents_discussion.assigned_agents).toBeUndefined()
    expect(logs[0].agents_discussion.trial_process).toBeUndefined()
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

    const savedCount = await saveSuggestedRulesFromLog(project, "t1")
    expect(savedCount).toBe(1)

    const rules = await getRules(project)
    expect(rules).toHaveLength(1)
    expect(rules[0].content).toBe("表形式にする")
  })

  it("存在しない task_id を指定するとエラーになる", async () => {
    const project = await makeProject()
    await fs.writeFile(path.join(project.path, "execution_log.json"), JSON.stringify({ logs: [] }))
    await expect(saveSuggestedRulesFromLog(project, "unknown")).rejects.toThrow()
  })
})
