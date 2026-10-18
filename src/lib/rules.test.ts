import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it, vi } from "vitest"
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

describe("書き換えの前の退避(CLAUDE.md.ccd-backup.<epoch>)", () => {
  async function backupContents(project: ProjectConfig): Promise<string[]> {
    const names = (await fs.readdir(project.path)).filter((f) => f.startsWith("CLAUDE.md.ccd-backup."))
    names.sort((a, b) => Number(a.split(".").pop()) - Number(b.split(".").pop()))
    return Promise.all(names.map((n) => fs.readFile(path.join(project.path, n), "utf-8")))
  }

  it("CLAUDE.mdがまだ無いときの最初の追加では、退避するものが無いので作らない", async () => {
    const project = await makeProject()
    await createRule(project, { category: "構成", content: "最初" })
    expect(await backupContents(project)).toEqual([])
  })

  it("追加・編集・有効無効の切り替え・並べ替え・削除の、どれも書き換え前の内容を退避する", async () => {
    const project = await makeProject()
    const claudeMdPath = path.join(project.path, "CLAUDE.md")
    await fs.writeFile(claudeMdPath, "# 前文\n\n## A\n内容A\n\n## B\n内容B\n")

    const snapshots: string[] = []
    const snap = async () => snapshots.push(await fs.readFile(claudeMdPath, "utf-8"))

    await snap()
    const created = await createRule(project, { category: "C", content: "内容C" })
    await snap()
    await updateRule(project, created.id, { content: "内容C改" })
    await snap()
    await updateRule(project, created.id, { enabled: false })
    await snap()
    const before = await getRules(project)
    await reorderRules(project, [before[2].id, before[0].id, before[1].id])
    await snap()
    const [first] = await getRules(project)
    await deleteRule(project, first.id)

    // 5回の書き込みそれぞれについて、書き込み直前の内容が1世代ずつ退避されている
    expect(await backupContents(project)).toEqual(snapshots)
  })

  it("削除で消えた見出しの内容は、退避から読み戻せる", async () => {
    const project = await makeProject()
    const rule = await createRule(project, { category: "守る", content: "大事なルール" })
    await createRule(project, { category: "別", content: "別のルール" })

    await deleteRule(project, rule.id)

    expect(await fs.readFile(path.join(project.path, "CLAUDE.md"), "utf-8")).not.toContain("大事なルール")
    const backups = await backupContents(project)
    expect(backups[backups.length - 1]).toContain("大事なルール")
  })

  it("退避に失敗したときは、CLAUDE.mdを書き換えずにエラーにする", async () => {
    const project = await makeProject()
    const claudeMdPath = path.join(project.path, "CLAUDE.md")
    const original = ["## A", "内容A", ""].join("\n")
    await fs.writeFile(claudeMdPath, original)
    const copy = vi.spyOn(fs, "copyFile").mockRejectedValueOnce(new Error("EACCES: 退避先に書けない"))
    try {
      await expect(createRule(project, { category: "B", content: "内容B" })).rejects.toThrow("EACCES")
    } finally {
      copy.mockRestore()
    }
    expect(await fs.readFile(claudeMdPath, "utf-8")).toBe(original)
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

  it("IDが重複し別のIDが欠落している場合はエラーになり、ルールが消失しない", async () => {
    const project = await makeProject()
    await createRule(project, { category: "構成", content: "A" })
    await createRule(project, { category: "ビジュアル", content: "B" })
    await createRule(project, { category: "トーン", content: "C" })

    const before = await getRules(project)
    // 個数はrules.lengthと一致するが、before[1]を欠落させbefore[0]を重複させている
    const brokenOrderedIds = [before[0].id, before[0].id, before[2].id]

    await expect(reorderRules(project, brokenOrderedIds)).rejects.toThrow()

    const after = await getRules(project)
    expect(after.map((r) => r.category)).toEqual(["構成", "ビジュアル", "トーン"])
  })
})
