import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { applyImport, validateBundle } from "./exportImport"
import { archiveCurrentVersion, listArchivedVersions, restoreArchivedVersion } from "./skillArchive"
import { assertValidModelName, isDotOnlyName, sanitizeModelDirName } from "./skillArchivePaths"
import { createSkill, updateSkill } from "./skills"
import { ExportBundle, ProjectConfig } from "./types"

// モデル名に `.`・`..` を使った、skills-archive の外へのパストラバーサルを塞ぐ（04-fixes.verify.md 5.4 指摘1）
const cleanupDirs: string[] = []
const DOT_ONLY = [".", "..", "...", " .. ", " . ", "\t..\n"]
/** `.` だけではないが、パス区切りを含み、置き換え後に `.` だけの並びに近づく名前 */
const SEPARATOR_MODELS = ["./..", "../..", "..\\..", "a/../..", "../", "./"]

async function makeProject(): Promise<ProjectConfig> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-skill-model-test-"))
  cleanupDirs.push(tmpDir)
  return { id: "test", name: "test", path: tmpDir }
}

async function writeSkill(project: ProjectConfig, dirName: string, targetModel: string, body = "本文") {
  const dir = path.join(project.path, "skills", dirName)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---\nname: ${dirName}\ndescription: desc\ntarget-model: ${targetModel}\n---\n\n${body}\n`
  )
}

/** プロジェクト直下の、フォルダ・ファイルの名前と中身の一覧（外に何も作られない・動かないことの確認に使う） */
async function snapshot(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = []
  for (const dirent of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = `${prefix}${dirent.name}`
    if (dirent.isDirectory()) out.push(`${rel}/`, ...(await snapshot(path.join(dir, dirent.name), `${rel}/`)))
    else out.push(`${rel}=${await fs.readFile(path.join(dir, dirent.name), "utf-8")}`)
  }
  return out.sort()
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("sanitizeModelDirName / isDotOnlyName", () => {
  it("`.` だけの名前は、skills-archive の外を指さない名前（先頭に _）になる。前後の空白は無視", () => {
    expect(sanitizeModelDirName(".")).toBe("_.")
    expect(sanitizeModelDirName("..")).toBe("_..")
    expect(sanitizeModelDirName("...")).toBe("_...")
    expect(sanitizeModelDirName(" .. ")).toBe("_..")
    expect(sanitizeModelDirName("\t..\n")).toBe("_..")
  })

  it("パス区切りを含む名前は、区切りを _ に置き換える（従来どおり）。結果は1つのフォルダ名で、親を指さない", () => {
    expect(sanitizeModelDirName("./..")).toBe("._..")
    expect(sanitizeModelDirName("../..")).toBe(".._..")
    expect(sanitizeModelDirName("..\\..")).toBe(".._..")
    expect(sanitizeModelDirName("a/../..")).toBe("a_.._..")
    expect(sanitizeModelDirName("../")).toBe(".._")
    expect(sanitizeModelDirName("./")).toBe("._")
    for (const model of [...DOT_ONLY, ...SEPARATOR_MODELS, "", "  ", "Opus 5", "モデル:名*前?"]) {
      const name = sanitizeModelDirName(model)
      expect(name, model).not.toMatch(/[\\/]/)
      expect(name, model).not.toMatch(/^\.+$/)
      expect(name.length, model).toBeGreaterThan(0)
    }
  })

  it("空・空白だけは _未設定。ふつうのモデル名は変わらない", () => {
    expect(sanitizeModelDirName("")).toBe("_未設定")
    expect(sanitizeModelDirName("   ")).toBe("_未設定")
    expect(sanitizeModelDirName("Opus 5")).toBe("Opus 5")
    expect(sanitizeModelDirName("Opus 4.5")).toBe("Opus 4.5")
    expect(sanitizeModelDirName(".hidden")).toBe(".hidden")
    expect(sanitizeModelDirName("a..b")).toBe("a..b")
  })

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

describe("切り替え（restoreArchivedVersion）: モデル名が `.` だけなら拒否し、何も作らない・動かさない", () => {
  it("`.`・`..`・`...`・前後に空白のある `..` は「不正なモデル名です」で拒否し、プロジェクトの中身は変わらない", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5", "現在")
    // プロジェクト直下に、切り替えの元になりうる同名のフォルダ（traversal の先）を用意する
    await fs.mkdir(path.join(project.path, "my-skill"))
    await fs.writeFile(path.join(project.path, "my-skill", "SKILL.md"), "---\nname: my-skill\n---\n\n外のスキル\n")
    await fs.mkdir(path.join(project.path, "skills-trash", "x"), { recursive: true })
    await fs.writeFile(path.join(project.path, "skills-trash", "x", "SKILL.md"), "退避済み")
    const before = await snapshot(project.path)

    for (const model of DOT_ONLY) {
      await expect(restoreArchivedVersion(project, "my-skill", model), model).rejects.toThrow("不正なモデル名です")
    }
    expect(await snapshot(project.path)).toEqual(before)
  })

  it("`./..` などパス区切りを含む名前は、1つのフォルダ名に置き換わる。見つからなければ「見つかりません」で、skills-archive の外に何も作られない", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5", "現在")
    await fs.mkdir(path.join(project.path, "my-skill"))
    await fs.writeFile(path.join(project.path, "my-skill", "SKILL.md"), "外のスキル")
    const before = await snapshot(project.path)

    for (const model of SEPARATOR_MODELS) {
      await expect(restoreArchivedVersion(project, "my-skill", model), model).rejects.toThrow("見つかりません")
    }
    expect(await snapshot(project.path)).toEqual(before)
  })
})

describe("アーカイブ（archiveCurrentVersion）: 対象モデルが `.` だけでも、skills-archive の外を読み書きしない", () => {
  it.each(DOT_ONLY.map((m) => [m]))("対象モデルが %j のスキルをアーカイブしても、プロジェクト直下の同名のフォルダは動かない", async (model) => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", JSON.stringify(model), "現在")
    // frontmatter の値は JSON 文字列として書いた（YAML で `..` の前後の空白を保つため）。読み取り結果が `.` だけの名前になることを確かめる
    const outside = path.join(project.path, "my-skill")
    await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, "SKILL.md"), "プロジェクト直下の同名のフォルダ")
    const before = await snapshot(project.path)

    await archiveCurrentVersion(project, "my-skill")

    const after = await snapshot(project.path)
    // 増えたのは skills-archive の中だけ。ほかは同じ
    const added = after.filter((x) => !before.includes(x))
    expect(added.length).toBeGreaterThan(0)
    expect(added.every((x) => x.startsWith("skills-archive/"))).toBe(true)
    expect(before.every((x) => after.includes(x))).toBe(true)
    expect(await fs.readFile(path.join(outside, "SKILL.md"), "utf-8")).toBe("プロジェクト直下の同名のフォルダ")
  })

  it("スキル名が skills・skills-trash でも、対象モデルが `..` なら、プロジェクト直下の skills・skills-trash は動かない", async () => {
    const project = await makeProject()
    await writeSkill(project, "skills-trash", "..", "ゴミ箱と同名のスキル")
    await writeSkill(project, "skills", "..", "skills と同名のスキル")
    await fs.mkdir(path.join(project.path, "skills-trash", "kept-trash"), { recursive: true })
    await fs.writeFile(path.join(project.path, "skills-trash", "kept-trash", "SKILL.md"), "退避済み")
    // プロジェクト直下の skills-trash は、スキル "skills-trash" の実体と同じ場所ではない（skills/skills-trash と skills-trash/ は別）
    const trashBefore = await snapshot(path.join(project.path, "skills-trash"))

    await archiveCurrentVersion(project, "skills-trash")
    await archiveCurrentVersion(project, "skills")

    expect(await snapshot(path.join(project.path, "skills-trash"))).toEqual(trashBefore)
    // アクティブなスキルは、そのまま（skills フォルダが動いて空になることはない）
    expect(await fs.readFile(path.join(project.path, "skills", "skills", "SKILL.md"), "utf-8")).toContain("skills と同名のスキル")
    expect(await fs.readFile(path.join(project.path, "skills", "skills-trash", "SKILL.md"), "utf-8")).toContain("ゴミ箱と同名のスキル")
    // アーカイブは、`_..` というフォルダに入る
    await fs.access(path.join(project.path, "skills-archive", "_..", "skills", "SKILL.md"))
    await fs.access(path.join(project.path, "skills-archive", "_..", "skills-trash", "SKILL.md"))
    expect((await fs.readdir(project.path)).sort()).toEqual(["skills", "skills-archive", "skills-trash"])
  })

  it("対象モデルが `..` のスキルのアーカイブは、一覧に出て、そこへ切り替えて戻せる（モデル名は `_..`）", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "..", "現在")
    await archiveCurrentVersion(project, "my-skill")

    const versions = await listArchivedVersions(project, "my-skill")
    expect(versions.map((v) => v.model)).toEqual(["_.."])

    await writeSkill(project, "my-skill", "Opus 5", "別のモデルの内容")
    await restoreArchivedVersion(project, "my-skill", "_..")
    expect(await fs.readFile(path.join(project.path, "skills", "my-skill", "SKILL.md"), "utf-8")).toContain("現在")
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
