import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { createRule, deleteRule, getRules, updateRule } from "./rules"
import { ProjectConfig } from "./types"

const cleanupDirs: string[] = []

async function makeProject(): Promise<ProjectConfig> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-rules-test-"))
  cleanupDirs.push(tmpDir)
  return { id: "test", name: "test", path: tmpDir }
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("createRule", () => {
  it("既存ルールがない場合 rule_001 を採番する", async () => {
    const project = await makeProject()
    const rule = await createRule(project, { category: "構成", content: "テスト" })
    expect(rule.id).toBe("rule_001")
  })

  it("既存の最大連番+1を採番する", async () => {
    const project = await makeProject()
    await fs.writeFile(
      path.join(project.path, "rules.json"),
      JSON.stringify({
        rules: [
          { id: "rule_001", category: "a", content: "a", enabled: true, created_at: "x", updated_at: "x" },
          { id: "rule_005", category: "a", content: "a", enabled: true, created_at: "x", updated_at: "x" },
        ],
      })
    )
    const rule = await createRule(project, { category: "構成", content: "テスト" })
    expect(rule.id).toBe("rule_006")
  })

  it("作成後 CLAUDE.md にルール内容が反映される", async () => {
    const project = await makeProject()
    await createRule(project, { category: "構成", content: "冒頭に結論を書く" })
    const claudeMd = await fs.readFile(path.join(project.path, "CLAUDE.md"), "utf-8")
    expect(claudeMd).toContain("冒頭に結論を書く")
  })
})

describe("updateRule / deleteRule", () => {
  it("enabled を false にすると CLAUDE.md から本文が消える", async () => {
    const project = await makeProject()
    const rule = await createRule(project, { category: "構成", content: "対象ルール" })
    let claudeMd = await fs.readFile(path.join(project.path, "CLAUDE.md"), "utf-8")
    expect(claudeMd).toContain("対象ルール")

    await updateRule(project, rule.id, { enabled: false })
    claudeMd = await fs.readFile(path.join(project.path, "CLAUDE.md"), "utf-8")
    expect(claudeMd).not.toContain("対象ルール")
  })

  it("存在しないIDを更新しようとするとエラーになる", async () => {
    const project = await makeProject()
    await expect(updateRule(project, "rule_999", { content: "x" })).rejects.toThrow()
  })

  it("削除すると rules.json から消え、CLAUDE.md からも消える", async () => {
    const project = await makeProject()
    const rule = await createRule(project, { category: "構成", content: "消えるルール" })
    await deleteRule(project, rule.id)

    const rulesFile = await getRules(project)
    expect(rulesFile.rules).toHaveLength(0)

    const claudeMd = await fs.readFile(path.join(project.path, "CLAUDE.md"), "utf-8")
    expect(claudeMd).not.toContain("消えるルール")
  })
})
