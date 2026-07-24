import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { applyImport, buildExportBundle, computeImportDiff, validateBundle } from "./exportImport"
import { ExportBundle, ProjectConfig } from "./types"

const cleanupDirs: string[] = []

async function makeProject(): Promise<ProjectConfig> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-exportimport-test-"))
  cleanupDirs.push(tmpDir)
  return { id: "test", name: "テストプロジェクト", path: tmpDir }
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("buildExportBundle", () => {
  it("CLAUDE.mdのルールとskillsのスキルをバンドル化する", async () => {
    const project = await makeProject()
    await fs.writeFile(path.join(project.path, "CLAUDE.md"), "## ルールA\n本文A\n")
    await fs.mkdir(path.join(project.path, "skills", "s1"), { recursive: true })
    await fs.writeFile(
      path.join(project.path, "skills", "s1", "SKILL.md"),
      "---\nname: s1\ndescription: desc1\n---\n\nbody1\n"
    )

    const bundle = await buildExportBundle(project)
    expect(bundle.version).toBe(1)
    expect(bundle.rules).toEqual([{ category: "ルールA", content: "本文A", enabled: true }])
    expect(bundle.skills).toMatchObject([{ dirName: "s1", name: "s1", description: "desc1", body: "body1" }])
  })
})

describe("validateBundle", () => {
  it("正しい形式ならそのまま受け入れる", () => {
    const bundle = validateBundle({
      version: 1,
      exportedAt: "2026-01-01T00:00:00.000Z",
      sourceProjectName: "src",
      rules: [{ category: "A", content: "c", enabled: true }],
      skills: [],
    })
    expect(bundle.rules).toHaveLength(1)
  })

  it("versionが違えば拒否する", () => {
    expect(() => validateBundle({ version: 2, rules: [], skills: [] })).toThrow()
  })

  it("rules/skillsが配列でなければ拒否する", () => {
    expect(() => validateBundle({ version: 1, rules: "x", skills: [] })).toThrow()
  })

  it("ルールにcontentが無ければ拒否する", () => {
    expect(() =>
      validateBundle({ version: 1, rules: [{ category: "A" }], skills: [] })
    ).toThrow()
  })
})

describe("computeImportDiff", () => {
  it("既存に無いルール/スキルはnewになる", async () => {
    const project = await makeProject()
    const bundle: ExportBundle = {
      version: 1,
      exportedAt: "now",
      sourceProjectName: "src",
      rules: [{ category: "新ルール", content: "内容", enabled: true }],
      skills: [{ dirName: "new-skill", name: "new-skill", description: "d", body: "b" }],
    }
    const diff = await computeImportDiff(project, bundle)
    expect(diff.items).toEqual([
      { kind: "rule", key: "新ルール", status: "new", before: null, after: "内容" },
      { kind: "skill", key: "new-skill", status: "new", before: null, after: "b" },
    ])
  })

  it("内容が異なればchanged、同じならunchangedになる", async () => {
    const project = await makeProject()
    await fs.writeFile(project.path + "/CLAUDE.md", "## 既存ルール\n旧内容\n")
    await fs.mkdir(path.join(project.path, "skills", "existing"), { recursive: true })
    await fs.writeFile(
      path.join(project.path, "skills", "existing", "SKILL.md"),
      "---\nname: existing\ndescription: 旧\n---\n\n旧本文\n"
    )

    const bundle: ExportBundle = {
      version: 1,
      exportedAt: "now",
      sourceProjectName: "src",
      rules: [
        { category: "既存ルール", content: "新内容", enabled: true },
      ],
      skills: [{ dirName: "existing", name: "existing", description: "旧", body: "旧本文" }],
    }
    const diff = await computeImportDiff(project, bundle)
    const rule = diff.items.find((i) => i.kind === "rule")
    const skill = diff.items.find((i) => i.kind === "skill")
    expect(rule?.status).toBe("changed")
    expect(skill?.status).toBe("unchanged")
  })

  it("不正な形式のスキルdirNameはinvalidになる", async () => {
    const project = await makeProject()
    const bundle: ExportBundle = {
      version: 1,
      exportedAt: "now",
      sourceProjectName: "src",
      rules: [],
      skills: [{ dirName: "../../etc", name: "x", description: "x", body: "x" }],
    }
    const diff = await computeImportDiff(project, bundle)
    expect(diff.items[0].status).toBe("invalid")
  })
})

describe("applyImport", () => {
  it("選択したルールのみCLAUDE.mdに反映し、既存見出しは上書き・新規は追加する", async () => {
    const project = await makeProject()
    await fs.writeFile(project.path + "/CLAUDE.md", "# タイトル\n\n## 既存ルール\n旧内容\n\n## 別ルール\n別内容\n")

    const bundle: ExportBundle = {
      version: 1,
      exportedAt: "now",
      sourceProjectName: "src",
      rules: [
        { category: "既存ルール", content: "新内容", enabled: true },
        { category: "追加ルール", content: "追加内容", enabled: true },
      ],
      skills: [],
    }
    await applyImport(project, bundle, { ruleCategories: ["既存ルール", "追加ルール"], skillDirNames: [] })

    const content = await fs.readFile(project.path + "/CLAUDE.md", "utf-8")
    expect(content).toContain("新内容")
    expect(content).toContain("別ルール")
    expect(content).toContain("別内容")
    expect(content).toContain("追加ルール")
    expect(content).toContain("追加内容")
  })

  it("上書き前にCLAUDE.mdのバックアップを作成する", async () => {
    const project = await makeProject()
    await fs.writeFile(project.path + "/CLAUDE.md", "## 既存ルール\n旧内容\n")

    const bundle: ExportBundle = {
      version: 1,
      exportedAt: "now",
      sourceProjectName: "src",
      rules: [{ category: "既存ルール", content: "新内容", enabled: true }],
      skills: [],
    }
    const result = await applyImport(project, bundle, { ruleCategories: ["既存ルール"], skillDirNames: [] })
    expect(result.backups).toHaveLength(1)
    const backupContent = await fs.readFile(result.backups[0], "utf-8")
    expect(backupContent).toContain("旧内容")
  })

  it("選択したスキルのみ書き込み、既存があればバックアップしてから上書きする", async () => {
    const project = await makeProject()
    await fs.mkdir(path.join(project.path, "skills", "existing"), { recursive: true })
    await fs.writeFile(
      path.join(project.path, "skills", "existing", "SKILL.md"),
      "---\nname: existing\ndescription: 旧\n---\n\n旧本文\n"
    )

    const bundle: ExportBundle = {
      version: 1,
      exportedAt: "now",
      sourceProjectName: "src",
      rules: [],
      skills: [
        { dirName: "existing", name: "existing", description: "新", body: "新本文" },
        { dirName: "brand-new", name: "brand-new", description: "d", body: "b" },
      ],
    }
    const result = await applyImport(project, bundle, {
      ruleCategories: [],
      skillDirNames: ["existing", "brand-new"],
    })

    expect(result.backups).toHaveLength(1)
    const updated = await fs.readFile(path.join(project.path, "skills", "existing", "SKILL.md"), "utf-8")
    expect(updated).toContain("新本文")
    const created = await fs.readFile(path.join(project.path, "skills", "brand-new", "SKILL.md"), "utf-8")
    expect(created).toContain("b")
  })

  it("不正な形式のdirNameは選択されていても書き込まない", async () => {
    const project = await makeProject()
    const bundle: ExportBundle = {
      version: 1,
      exportedAt: "now",
      sourceProjectName: "src",
      rules: [],
      skills: [{ dirName: "../evil", name: "x", description: "x", body: "x" }],
    }
    const result = await applyImport(project, bundle, { ruleCategories: [], skillDirNames: ["../evil"] })
    expect(result.backups).toEqual([])
    await expect(fs.access(path.join(project.path, "..", "evil"))).rejects.toThrow()
  })
})
