import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { applyRefactorProposal, computeRefactorDiff } from "./ruleRefactor"
import { ProjectConfig } from "./types"

const cleanupDirs: string[] = []

async function makeProject(): Promise<ProjectConfig> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-rulerefactor-test-"))
  cleanupDirs.push(tmpDir)
  return { id: "test", name: "test", path: tmpDir }
}

async function writeClaudeMd(project: ProjectConfig, content: string): Promise<void> {
  await fs.writeFile(path.join(project.path, "CLAUDE.md"), content)
}

async function writeProposal(project: ProjectConfig, data: unknown): Promise<void> {
  await fs.writeFile(
    path.join(project.path, "rule_refactor_proposal.json"),
    JSON.stringify(data, null, 2)
  )
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("computeRefactorDiff", () => {
  it("提案ファイルが無ければ空の結果になる", async () => {
    const project = await makeProject()
    const diff = await computeRefactorDiff(project)
    expect(diff).toEqual({ generatedAt: null, items: [] })
  })

  it("modify提案：現在の内容がbefore、提案内容がafterになりreadyと判定される", async () => {
    const project = await makeProject()
    await writeClaudeMd(project, "## トーン\n旧トーン\n")
    await writeProposal(project, {
      version: 1,
      generatedAt: "2026-07-25T00:00:00.000Z",
      proposals: [
        {
          type: "modify",
          targetCategory: "トーン",
          sourceCategories: ["トーン"],
          content: "新トーン",
          reason: "曖昧な表現を明確化",
        },
      ],
    })

    const diff = await computeRefactorDiff(project)
    expect(diff.generatedAt).toBe("2026-07-25T00:00:00.000Z")
    expect(diff.items).toEqual([
      {
        index: 0,
        type: "modify",
        targetCategory: "トーン",
        sourceCategories: ["トーン"],
        reason: "曖昧な表現を明確化",
        status: "ready",
        before: "## トーン\n旧トーン",
        after: "新トーン",
      },
    ])
  })

  it("merge提案：複数のsourceCategoriesの内容がbeforeに連結される", async () => {
    const project = await makeProject()
    await writeClaudeMd(project, "## 構成A\n内容A\n\n## 構成B\n内容B\n")
    await writeProposal(project, {
      version: 1,
      generatedAt: "now",
      proposals: [
        {
          type: "merge",
          targetCategory: "構成",
          sourceCategories: ["構成A", "構成B"],
          content: "統合後の内容",
          reason: "重複ルールの統合",
        },
      ],
    })

    const diff = await computeRefactorDiff(project)
    expect(diff.items[0].status).toBe("ready")
    expect(diff.items[0].before).toBe("## 構成A\n内容A\n\n## 構成B\n内容B")
    expect(diff.items[0].after).toBe("統合後の内容")
  })

  it("remove提案：afterはnullになる", async () => {
    const project = await makeProject()
    await writeClaudeMd(project, "## 不要ルール\n内容\n")
    await writeProposal(project, {
      version: 1,
      generatedAt: "now",
      proposals: [
        {
          type: "remove",
          targetCategory: "不要ルール",
          sourceCategories: ["不要ルール"],
          content: null,
          reason: "他のルールと完全に重複",
        },
      ],
    })

    const diff = await computeRefactorDiff(project)
    expect(diff.items[0].after).toBeNull()
    expect(diff.items[0].status).toBe("ready")
  })

  it("sourceCategoriesが現在のCLAUDE.mdに存在しなければstaleと判定される", async () => {
    const project = await makeProject()
    await writeClaudeMd(project, "## 現存ルール\n内容\n")
    await writeProposal(project, {
      version: 1,
      generatedAt: "now",
      proposals: [
        {
          type: "modify",
          targetCategory: "消えたルール",
          sourceCategories: ["消えたルール"],
          content: "新内容",
          reason: "テスト",
        },
      ],
    })

    const diff = await computeRefactorDiff(project)
    expect(diff.items[0].status).toBe("stale")
    expect(diff.items[0].staleReason).toContain("消えたルール")
  })

  it("形式が不正な提案要素は黙ってスキップし、正常な要素のみ結果に含める", async () => {
    const project = await makeProject()
    await writeClaudeMd(project, "## 正常ルール\n内容\n")
    await writeProposal(project, {
      version: 1,
      generatedAt: "now",
      proposals: [
        { type: "modify", targetCategory: "正常ルール", sourceCategories: ["正常ルール"], content: "新内容" },
        {
          type: "modify",
          targetCategory: "正常ルール",
          sourceCategories: ["正常ルール"],
          content: "新内容2",
          reason: "reasonがある正常な要素",
        },
      ],
    })

    const diff = await computeRefactorDiff(project)
    expect(diff.items).toHaveLength(1)
    expect(diff.items[0].after).toBe("新内容2")
  })
})

describe("applyRefactorProposal", () => {
  it("modifyを適用するとCLAUDE.mdの該当見出しの内容だけが変わる", async () => {
    const project = await makeProject()
    await writeClaudeMd(project, "## トーン\n旧トーン\n\n## 構成\n構成内容\n")
    await writeProposal(project, {
      version: 1,
      generatedAt: "now",
      proposals: [
        { type: "modify", targetCategory: "トーン", sourceCategories: ["トーン"], content: "新トーン", reason: "r" },
      ],
    })

    const result = await applyRefactorProposal(project, [0])
    expect(result.backups).toHaveLength(1)

    const content = await fs.readFile(path.join(project.path, "CLAUDE.md"), "utf-8")
    expect(content).toContain("新トーン")
    expect(content).not.toContain("旧トーン")
    expect(content).toContain("構成内容")
  })

  it("mergeを適用すると統合元2件が消え統合後の1件になる", async () => {
    const project = await makeProject()
    await writeClaudeMd(project, "## 構成A\n内容A\n\n## 構成B\n内容B\n")
    await writeProposal(project, {
      version: 1,
      generatedAt: "now",
      proposals: [
        {
          type: "merge",
          targetCategory: "構成統合",
          sourceCategories: ["構成A", "構成B"],
          content: "統合後の内容",
          reason: "r",
        },
      ],
    })

    await applyRefactorProposal(project, [0])
    const content = await fs.readFile(path.join(project.path, "CLAUDE.md"), "utf-8")
    expect(content).toContain("構成統合")
    expect(content).toContain("統合後の内容")
    expect(content).not.toContain("## 構成A")
    expect(content).not.toContain("## 構成B")
  })

  it("removeを適用すると対象の見出しごと消える", async () => {
    const project = await makeProject()
    await writeClaudeMd(project, "## 不要ルール\n内容\n\n## 残すルール\n残す内容\n")
    await writeProposal(project, {
      version: 1,
      generatedAt: "now",
      proposals: [
        { type: "remove", targetCategory: "不要ルール", sourceCategories: ["不要ルール"], content: null, reason: "r" },
      ],
    })

    await applyRefactorProposal(project, [0])
    const content = await fs.readFile(path.join(project.path, "CLAUDE.md"), "utf-8")
    expect(content).not.toContain("不要ルール")
    expect(content).toContain("残すルール")
  })

  it("staleな提案（sourceCategoriesが現存しない）を選択して適用しようとするとエラーになり、CLAUDE.mdは変更されない", async () => {
    const project = await makeProject()
    await writeClaudeMd(project, "## 現存ルール\n内容\n")
    await writeProposal(project, {
      version: 1,
      generatedAt: "now",
      proposals: [
        {
          type: "modify",
          targetCategory: "消えたルール",
          sourceCategories: ["消えたルール"],
          content: "新内容",
          reason: "r",
        },
      ],
    })

    await expect(applyRefactorProposal(project, [0])).rejects.toThrow()
    const content = await fs.readFile(path.join(project.path, "CLAUDE.md"), "utf-8")
    expect(content).toContain("現存ルール")
  })

  it("提案ファイルが無い場合はエラーになる", async () => {
    const project = await makeProject()
    await writeClaudeMd(project, "## ルール\n内容\n")
    await expect(applyRefactorProposal(project, [0])).rejects.toThrow()
  })

  it("選択が空なら何も変更せずbackupsも空になる", async () => {
    const project = await makeProject()
    await writeClaudeMd(project, "## ルール\n内容\n")
    await writeProposal(project, {
      version: 1,
      generatedAt: "now",
      proposals: [
        { type: "remove", targetCategory: "ルール", sourceCategories: ["ルール"], content: null, reason: "r" },
      ],
    })

    const result = await applyRefactorProposal(project, [])
    expect(result.backups).toEqual([])
    const content = await fs.readFile(path.join(project.path, "CLAUDE.md"), "utf-8")
    expect(content).toContain("ルール")
  })
})
