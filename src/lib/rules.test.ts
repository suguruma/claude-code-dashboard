import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { createRule, deleteRule, getRules, reorderRules, updateRule } from "./rules"
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

describe("reorderRules", () => {
  it("指定した順序どおりに CLAUDE.md の見出し順が入れ替わる", async () => {
    const project = await makeProject()
    await createRule(project, { category: "構成", content: "A" })
    await createRule(project, { category: "ビジュアル", content: "B" })
    await createRule(project, { category: "トーン", content: "C" })

    const before = await getRules(project)
    expect(before.map((r) => r.category)).toEqual(["構成", "ビジュアル", "トーン"])

    const reordered = await reorderRules(project, [before[2].id, before[0].id, before[1].id])
    expect(reordered.map((r) => r.category)).toEqual(["トーン", "構成", "ビジュアル"])

    const after = await getRules(project)
    expect(after.map((r) => r.category)).toEqual(["トーン", "構成", "ビジュアル"])
  })

  it("無効化(enabled:false)状態は並び替え後も保持される", async () => {
    const project = await makeProject()
    const ruleA = await createRule(project, { category: "A", content: "内容A" })
    await createRule(project, { category: "B", content: "内容B" })
    await updateRule(project, ruleA.id, { enabled: false })

    const before = await getRules(project)
    const reordered = await reorderRules(project, [before[1].id, before[0].id])

    expect(reordered.find((r) => r.category === "A")?.enabled).toBe(false)
    const claudeMd = await fs.readFile(path.join(project.path, "CLAUDE.md"), "utf-8")
    expect(claudeMd).toContain("<!-- CCD:DISABLED")
  })

  it("orderedIdsの個数が現在のルール数と一致しない場合はエラーになる", async () => {
    const project = await makeProject()
    const rule = await createRule(project, { category: "構成", content: "A" })
    await createRule(project, { category: "ビジュアル", content: "B" })

    await expect(reorderRules(project, [rule.id])).rejects.toThrow()
  })

  it("存在しないIDが含まれる場合はエラーになる", async () => {
    const project = await makeProject()
    await createRule(project, { category: "構成", content: "A" })

    await expect(reorderRules(project, ["sec-999"])).rejects.toThrow()
  })
})
