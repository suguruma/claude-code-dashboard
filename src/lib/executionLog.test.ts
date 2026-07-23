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
})

describe("saveSuggestedRulesFromLog", () => {
  it("指定タスクの suggested_new_rules を rules.json に追加する", async () => {
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
