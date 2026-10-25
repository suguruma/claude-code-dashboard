import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { applyImport, validateBundle } from "./exportImport"
import { assertValidModelName, isDotOnlyName } from "./skillArchivePaths"
import { createSkill, updateSkill } from "./skills"
import { ExportBundle, ProjectConfig } from "./types"

// モデル名に `.`・`..` を使った、skills-archive の外へのパストラバーサルを塞ぐ（04-fixes.verify.md 5.4 指摘1）
const cleanupDirs: string[] = []
const DOT_ONLY = [".", "..", "...", " .. ", " . ", "\t..\n"]
async function makeProject(): Promise<ProjectConfig> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-skill-model-test-"))
  cleanupDirs.push(tmpDir)
  return { id: "test", name: "test", path: tmpDir }
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("isDotOnlyName / assertValidModelName", () => {
  it("isDotOnlyName / assertValidModelName: `.` だけ（前後の空白は無視）だけを拒否する", () => {
    for (const model of DOT_ONLY) {
      expect(isDotOnlyName(model), model).toBe(true)
      expect(() => assertValidModelName(model), model).toThrow("不正なモデル名です")
    }
    for (const model of ["", "Opus 5", ".hidden", "a..b", "./..", "..x", "x.."]) {
      expect(isDotOnlyName(model), model).toBe(false)
      expect(() => assertValidModelName(model), model).not.toThrow()
    }
  })
})

describe("対象モデル（target-model）を書く側: 更新・作成・インポートでも拒否する", () => {
  it("createSkill / updateSkill は、`.` だけの対象モデルを拒否し、何も書かない。空（未設定に戻す）とふつうの名前は通る", async () => {
    const project = await makeProject()
    for (const model of DOT_ONLY) {
      await expect(createSkill(project, { dirName: "new-skill", description: "d", body: "b", targetModel: model }), model).rejects.toThrow("不正なモデル名です")
    }
    await expect(fs.access(path.join(project.path, "skills", "new-skill"))).rejects.toThrow()

    await createSkill(project, { dirName: "my-skill", description: "d", body: "b", targetModel: "Opus 5" })
    const before = await fs.readFile(path.join(project.path, "skills", "my-skill", "SKILL.md"), "utf-8")
    for (const model of DOT_ONLY) {
      await expect(updateSkill(project, "my-skill", { targetModel: model }), model).rejects.toThrow("不正なモデル名です")
    }
    expect(await fs.readFile(path.join(project.path, "skills", "my-skill", "SKILL.md"), "utf-8")).toBe(before)
    expect(await fs.readdir(path.join(project.path, "skills", "my-skill"))).toEqual(["SKILL.md"])

    await updateSkill(project, "my-skill", { targetModel: "" })
    await updateSkill(project, "my-skill", { targetModel: "Sonnet 5" })
  })

  const bundleWith = (targetModel: unknown): unknown => ({
    version: 1,
    exportedAt: "now",
    sourceProjectName: "src",
    rules: [],
    skills: [{ dirName: "imported", name: "imported", description: "d", body: "b", targetModel }],
  })

  it("validateBundle は、`.` だけの対象モデルを持つスキルのバンドルを拒否する。ふつうのモデル名・無指定は通る", () => {
    for (const model of DOT_ONLY) {
      expect(() => validateBundle(bundleWith(model)), model).toThrow("対象モデルが不正です")
    }
    expect(validateBundle(bundleWith("Opus 5")).skills[0].targetModel).toBe("Opus 5")
    expect(validateBundle(bundleWith(undefined)).skills[0].targetModel).toBeUndefined()
    expect(validateBundle(bundleWith(".hidden")).skills[0].targetModel).toBe(".hidden")
  })

  it("applyImport は、検証をすり抜けたバンドルでも、`.` だけの対象モデルのスキルを書き込まない（ほかのスキルは書く）", async () => {
    const project = await makeProject()
    const bundle: ExportBundle = {
      version: 1,
      exportedAt: "now",
      sourceProjectName: "src",
      rules: [],
      skills: [
        { dirName: "evil", name: "evil", description: "d", body: "b", targetModel: ".." },
        { dirName: "fine", name: "fine", description: "d", body: "b", targetModel: "Opus 5" },
      ],
    }

    await applyImport(project, bundle, { ruleCategories: [], skillDirNames: ["evil", "fine"] })

    await expect(fs.access(path.join(project.path, "skills", "evil"))).rejects.toThrow()
    expect(await fs.readFile(path.join(project.path, "skills", "fine", "SKILL.md"), "utf-8")).toContain("target-model: Opus 5")
  })
})
