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

  it("スキルのcategoryもバンドルに含める", async () => {
    const project = await makeProject()
    await fs.mkdir(path.join(project.path, "skills", "categorized"), { recursive: true })
    await fs.writeFile(
      path.join(project.path, "skills", "categorized", "SKILL.md"),
      "---\nname: categorized\ndescription: desc\ncategory: dev-qa\n---\n\nbody\n"
    )

    const bundle = await buildExportBundle(project)
    expect(bundle.skills).toMatchObject([{ dirName: "categorized", category: "dev-qa" }])
  })

  it("スキルのtitle（表示名）もバンドルに含める", async () => {
    const project = await makeProject()
    await fs.mkdir(path.join(project.path, "skills", "titled"), { recursive: true })
    await fs.writeFile(
      path.join(project.path, "skills", "titled", "SKILL.md"),
      "---\nname: titled\ndescription: desc\ntitle: 表示用の名前\n---\n\nbody\n"
    )

    const bundle = await buildExportBundle(project)
    expect(bundle.skills).toMatchObject([{ dirName: "titled", title: "表示用の名前" }])
  })

  it("スキルのtargetModel（対象モデル）もバンドルに含める", async () => {
    const project = await makeProject()
    await fs.mkdir(path.join(project.path, "skills", "model-tagged"), { recursive: true })
    await fs.writeFile(
      path.join(project.path, "skills", "model-tagged", "SKILL.md"),
      "---\nname: model-tagged\ndescription: desc\ntarget-model: Opus 5\n---\n\nbody\n"
    )

    const bundle = await buildExportBundle(project)
    expect(bundle.skills).toMatchObject([{ dirName: "model-tagged", targetModel: "Opus 5" }])
  })

  it("スキルのupdatedAt（更新日）もバンドルに含める", async () => {
    const project = await makeProject()
    await fs.mkdir(path.join(project.path, "skills", "updated-skill"), { recursive: true })
    await fs.writeFile(
      path.join(project.path, "skills", "updated-skill", "SKILL.md"),
      "---\nname: updated-skill\ndescription: desc\nupdated: 2026-01-01T00:00:00.000Z\n---\n\nbody\n"
    )

    const bundle = await buildExportBundle(project)
    expect(bundle.skills).toMatchObject([{ dirName: "updated-skill", updatedAt: "2026-01-01T00:00:00.000Z" }])
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

  it("スキルのcategoryが文字列ならそのまま保持し、無ければundefinedになる", () => {
    const bundle = validateBundle({
      version: 1,
      rules: [],
      skills: [
        { dirName: "a", name: "a", description: "d", body: "b", category: "career" },
        { dirName: "b", name: "b", description: "d", body: "b" },
      ],
    })
    expect(bundle.skills[0].category).toBe("career")
    expect(bundle.skills[1].category).toBeUndefined()
  })

  it("スキルのtitleが文字列ならそのまま保持し、無ければundefinedになる", () => {
    const bundle = validateBundle({
      version: 1,
      rules: [],
      skills: [
        { dirName: "a", name: "a", description: "d", body: "b", title: "見出しA" },
        { dirName: "b", name: "b", description: "d", body: "b" },
      ],
    })
    expect(bundle.skills[0].title).toBe("見出しA")
    expect(bundle.skills[1].title).toBeUndefined()
  })

  it("スキルのtargetModelが文字列ならそのまま保持し、無ければundefinedになる", () => {
    const bundle = validateBundle({
      version: 1,
      rules: [],
      skills: [
        { dirName: "a", name: "a", description: "d", body: "b", targetModel: "Opus 5" },
        { dirName: "b", name: "b", description: "d", body: "b" },
      ],
    })
    expect(bundle.skills[0].targetModel).toBe("Opus 5")
    expect(bundle.skills[1].targetModel).toBeUndefined()
  })

  it("スキルのupdatedAtが文字列ならそのまま保持し、無ければundefinedになる", () => {
    const bundle = validateBundle({
      version: 1,
      rules: [],
      skills: [
        { dirName: "a", name: "a", description: "d", body: "b", updatedAt: "2026-01-01T00:00:00.000Z" },
        { dirName: "b", name: "b", description: "d", body: "b" },
      ],
    })
    expect(bundle.skills[0].updatedAt).toBe("2026-01-01T00:00:00.000Z")
    expect(bundle.skills[1].updatedAt).toBeUndefined()
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
      {
        kind: "skill",
        key: "new-skill",
        status: "new",
        before: null,
        after: "b",
        categoryBefore: null,
        categoryAfter: null,
        titleBefore: null,
        titleAfter: null,
        targetModelBefore: null,
        targetModelAfter: null,
      },
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

  it("bodyとdescriptionは同じでもcategoryだけ異なる場合はchangedになる", async () => {
    const project = await makeProject()
    await fs.mkdir(path.join(project.path, "skills", "existing"), { recursive: true })
    await fs.writeFile(
      path.join(project.path, "skills", "existing", "SKILL.md"),
      "---\nname: existing\ndescription: desc\ncategory: dev-qa\n---\n\n本文\n"
    )

    const bundle: ExportBundle = {
      version: 1,
      exportedAt: "now",
      sourceProjectName: "src",
      rules: [],
      skills: [{ dirName: "existing", name: "existing", description: "desc", body: "本文", category: "career" }],
    }
    const diff = await computeImportDiff(project, bundle)
    const skill = diff.items.find((i) => i.kind === "skill")
    expect(skill?.status).toBe("changed")
    expect(skill?.categoryBefore).toBe("dev-qa")
    expect(skill?.categoryAfter).toBe("career")
  })

  it("bodyとdescriptionは同じでもtitleだけ異なる場合はchangedになる", async () => {
    const project = await makeProject()
    await fs.mkdir(path.join(project.path, "skills", "existing"), { recursive: true })
    await fs.writeFile(
      path.join(project.path, "skills", "existing", "SKILL.md"),
      "---\nname: existing\ndescription: desc\ntitle: 旧見出し\n---\n\n本文\n"
    )

    const bundle: ExportBundle = {
      version: 1,
      exportedAt: "now",
      sourceProjectName: "src",
      rules: [],
      skills: [{ dirName: "existing", name: "existing", description: "desc", body: "本文", title: "新見出し" }],
    }
    const diff = await computeImportDiff(project, bundle)
    const skill = diff.items.find((i) => i.kind === "skill")
    expect(skill?.status).toBe("changed")
    expect(skill?.titleBefore).toBe("旧見出し")
    expect(skill?.titleAfter).toBe("新見出し")
  })

  it("bodyとdescriptionは同じでもtargetModelだけ異なる場合はchangedになる", async () => {
    const project = await makeProject()
    await fs.mkdir(path.join(project.path, "skills", "existing"), { recursive: true })
    await fs.writeFile(
      path.join(project.path, "skills", "existing", "SKILL.md"),
      "---\nname: existing\ndescription: desc\ntarget-model: Opus 4.8\n---\n\n本文\n"
    )

    const bundle: ExportBundle = {
      version: 1,
      exportedAt: "now",
      sourceProjectName: "src",
      rules: [],
      skills: [
        { dirName: "existing", name: "existing", description: "desc", body: "本文", targetModel: "Opus 5" },
      ],
    }
    const diff = await computeImportDiff(project, bundle)
    const skill = diff.items.find((i) => i.kind === "skill")
    expect(skill?.status).toBe("changed")
    expect(skill?.targetModelBefore).toBe("Opus 4.8")
    expect(skill?.targetModelAfter).toBe("Opus 5")
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

  it("スキルのcategoryもSKILL.mdのfrontmatterに書き込む", async () => {
    const project = await makeProject()
    const bundle: ExportBundle = {
      version: 1,
      exportedAt: "now",
      sourceProjectName: "src",
      rules: [],
      skills: [{ dirName: "categorized", name: "categorized", description: "d", body: "b", category: "writing" }],
    }
    await applyImport(project, bundle, { ruleCategories: [], skillDirNames: ["categorized"] })

    const content = await fs.readFile(path.join(project.path, "skills", "categorized", "SKILL.md"), "utf-8")
    expect(content).toContain("category: writing")
  })

  it("スキルのtitleもSKILL.mdのfrontmatterに書き込む", async () => {
    const project = await makeProject()
    const bundle: ExportBundle = {
      version: 1,
      exportedAt: "now",
      sourceProjectName: "src",
      rules: [],
      skills: [{ dirName: "titled", name: "titled", description: "d", body: "b", title: "表示名テスト" }],
    }
    await applyImport(project, bundle, { ruleCategories: [], skillDirNames: ["titled"] })

    const content = await fs.readFile(path.join(project.path, "skills", "titled", "SKILL.md"), "utf-8")
    expect(content).toContain("title: 表示名テスト")
  })

  it("スキルのtargetModelもSKILL.mdのfrontmatterに書き込む（キーはtarget-model）", async () => {
    const project = await makeProject()
    const bundle: ExportBundle = {
      version: 1,
      exportedAt: "now",
      sourceProjectName: "src",
      rules: [],
      skills: [
        { dirName: "model-tagged", name: "model-tagged", description: "d", body: "b", targetModel: "Opus 5" },
      ],
    }
    await applyImport(project, bundle, { ruleCategories: [], skillDirNames: ["model-tagged"] })

    const content = await fs.readFile(path.join(project.path, "skills", "model-tagged", "SKILL.md"), "utf-8")
    expect(content).toContain("target-model: Opus 5")
  })

  it("スキルのupdatedAtもSKILL.mdのfrontmatterに書き込む", async () => {
    const project = await makeProject()
    const bundle: ExportBundle = {
      version: 1,
      exportedAt: "now",
      sourceProjectName: "src",
      rules: [],
      skills: [
        {
          dirName: "dated",
          name: "dated",
          description: "d",
          body: "b",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    }
    await applyImport(project, bundle, { ruleCategories: [], skillDirNames: ["dated"] })

    const content = await fs.readFile(path.join(project.path, "skills", "dated", "SKILL.md"), "utf-8")
    expect(content).toContain("updated: '2026-01-01T00:00:00.000Z'")
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
