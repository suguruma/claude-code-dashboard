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
  it("CLAUDE.mdが存在しない場合でも新規作成できる", async () => {
    const project = await makeProject()
    const rule = await createRule(project, { category: "構成", content: "テスト" })
    expect(rule.category).toBe("構成")
    expect(rule.enabled).toBe(true)
  })

  it("作成後 CLAUDE.md に見出しとルール内容が反映される", async () => {
    const project = await makeProject()
    await createRule(project, { category: "構成", content: "冒頭に結論を書く" })
    const claudeMd = await fs.readFile(path.join(project.path, "CLAUDE.md"), "utf-8")
    expect(claudeMd).toContain("## 構成")
    expect(claudeMd).toContain("冒頭に結論を書く")
  })

  it("既存のCLAUDE.mdのpreamble(タイトル等)を保持したまま追記する", async () => {
    const project = await makeProject()
    await fs.writeFile(path.join(project.path, "CLAUDE.md"), "# グローバルルール\n\n## 既存ルール\n既存の内容\n")
    await createRule(project, { category: "新規", content: "新しい内容" })

    const claudeMd = await fs.readFile(path.join(project.path, "CLAUDE.md"), "utf-8")
    expect(claudeMd).toContain("# グローバルルール")
    expect(claudeMd).toContain("## 既存ルール")
    expect(claudeMd).toContain("## 新規")
  })
})

describe("updateRule / deleteRule", () => {
  it("enabled を false にすると CLAUDE.md 上で CCD:DISABLED コメントに包まれる", async () => {
    const project = await makeProject()
    const rule = await createRule(project, { category: "構成", content: "対象ルール" })

    await updateRule(project, rule.id, { enabled: false })
    const claudeMd = await fs.readFile(path.join(project.path, "CLAUDE.md"), "utf-8")
    expect(claudeMd).toContain("<!-- CCD:DISABLED")
    expect(claudeMd).toContain("対象ルール")

    const rules = await getRules(project)
    expect(rules.find((r) => r.category === "構成")?.enabled).toBe(false)
  })

  it("存在しないIDを更新しようとするとエラーになる", async () => {
    const project = await makeProject()
    await expect(updateRule(project, "sec-999", { content: "x" })).rejects.toThrow()
  })

  it("削除すると CLAUDE.md から見出しごと消える", async () => {
    const project = await makeProject()
    const rule = await createRule(project, { category: "構成", content: "消えるルール" })
    await deleteRule(project, rule.id)

    const rules = await getRules(project)
    expect(rules).toHaveLength(0)

    const claudeMd = await fs.readFile(path.join(project.path, "CLAUDE.md"), "utf-8")
    expect(claudeMd).not.toContain("消えるルール")
  })
})
