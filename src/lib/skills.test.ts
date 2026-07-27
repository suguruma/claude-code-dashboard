import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { createSkill, deleteSkill, getSkill, listSkills, renameSkill, updateSkill } from "./skills"
import { ProjectConfig } from "./types"

const cleanupDirs: string[] = []

async function makeProject(): Promise<ProjectConfig> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-skills-test-"))
  cleanupDirs.push(tmpDir)
  return { id: "test", name: "test", path: tmpDir }
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("listSkills", () => {
  it("skillsディレクトリが無ければ空配列を返す", async () => {
    const project = await makeProject()
    expect(await listSkills(project)).toEqual([])
  })

  it("SKILL.mdを持つディレクトリのみを一覧化する", async () => {
    const project = await makeProject()
    await fs.mkdir(path.join(project.path, "skills", "task"), { recursive: true })
    await fs.writeFile(
      path.join(project.path, "skills", "task", "SKILL.md"),
      "---\nname: task\ndescription: 高負荷制作チーム\n---\n\n本文\n"
    )
    await fs.mkdir(path.join(project.path, "skills", "empty-dir"), { recursive: true })

    const skills = await listSkills(project)
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({ dirName: "task", name: "task", description: "高負荷制作チーム" })
  })
})

describe("createSkill / updateSkill / deleteSkill", () => {
  it("新規スキルを作成しSKILL.mdを生成する", async () => {
    const project = await makeProject()
    const skill = await createSkill(project, {
      dirName: "my-skill",
      description: "テスト用スキル",
      body: "# 手順\n1. やる",
    })
    expect(skill.dirName).toBe("my-skill")

    const content = await fs.readFile(
      path.join(project.path, "skills", "my-skill", "SKILL.md"),
      "utf-8"
    )
    expect(content).toContain("name: my-skill")
    expect(content).toContain("description: テスト用スキル")
    expect(content).toContain("# 手順")
  })

  it("不正な名前（日本語・スペース等）は拒否する", async () => {
    const project = await makeProject()
    await expect(
      createSkill(project, { dirName: "不正な名前", description: "x", body: "" })
    ).rejects.toThrow()
  })

  it("同名スキルの重複作成はエラーになる", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "dup", description: "1つ目", body: "" })
    await expect(
      createSkill(project, { dirName: "dup", description: "2つ目", body: "" })
    ).rejects.toThrow()
  })

  it("description/bodyを更新できる", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "editable", description: "旧説明", body: "旧本文" })
    const updated = await updateSkill(project, "editable", { description: "新説明" })
    expect(updated.description).toBe("新説明")
    expect(updated.body).toBe("旧本文")

    const reread = await getSkill(project, "editable")
    expect(reread?.description).toBe("新説明")
  })

  it("argument-schema等の未編集フィールドは更新後も保持される", async () => {
    const project = await makeProject()
    await fs.mkdir(path.join(project.path, "skills", "with-schema"), { recursive: true })
    await fs.writeFile(
      path.join(project.path, "skills", "with-schema", "SKILL.md"),
      "---\nname: with-schema\ndescription: desc\nargument-schema:\n  type: object\n---\n\n本文\n"
    )
    const updated = await updateSkill(project, "with-schema", { description: "更新後" })
    expect(updated.argumentSchema).toMatchObject({ type: "object" })
  })

  it("categoryを指定して作成し、description更新後もcategoryが保持される", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "categorized", description: "x", body: "", category: "dev-qa" })
    const updated = await updateSkill(project, "categorized", { description: "更新後" })
    expect(updated.category).toBe("dev-qa")

    const content = await fs.readFile(
      path.join(project.path, "skills", "categorized", "SKILL.md"),
      "utf-8"
    )
    expect(content).toContain("category: dev-qa")
  })

  it("categoryに空文字を指定すると未分類に戻る", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "will-clear", description: "x", body: "", category: "career" })
    const updated = await updateSkill(project, "will-clear", { category: "" })
    expect(updated.category).toBeUndefined()

    const content = await fs.readFile(
      path.join(project.path, "skills", "will-clear", "SKILL.md"),
      "utf-8"
    )
    expect(content).not.toContain("category:")
  })

  it("titleを指定して作成し、description更新後もtitleが保持される", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "titled", description: "x", body: "", title: "表示名" })
    const updated = await updateSkill(project, "titled", { description: "更新後" })
    expect(updated.title).toBe("表示名")

    const content = await fs.readFile(path.join(project.path, "skills", "titled", "SKILL.md"), "utf-8")
    expect(content).toContain("title: 表示名")
  })

  it("titleに空文字を指定すると未設定に戻る", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "will-clear-title", description: "x", body: "", title: "旧見出し" })
    const updated = await updateSkill(project, "will-clear-title", { title: "" })
    expect(updated.title).toBeUndefined()

    const content = await fs.readFile(
      path.join(project.path, "skills", "will-clear-title", "SKILL.md"),
      "utf-8"
    )
    expect(content).not.toContain("title:")
  })

  it("createdAtは作成時にfrontmatterのcreatedへ保存される", async () => {
    const project = await makeProject()
    const skill = await createSkill(project, { dirName: "dated", description: "x", body: "" })
    expect(skill.createdAt).toBeDefined()
    expect(new Date(skill.createdAt!).toString()).not.toBe("Invalid Date")

    const content = await fs.readFile(path.join(project.path, "skills", "dated", "SKILL.md"), "utf-8")
    expect(content).toContain("created:")
  })

  it("createdAtは更新（description変更）してもリセットされない（書き込みは一時ファイル経由のrenameを伴うため、fs.stat依存だとbirthtimeがリセットされてしまう）", async () => {
    const project = await makeProject()
    const created = await createSkill(project, { dirName: "persist-date", description: "旧", body: "" })
    const updated = await updateSkill(project, "persist-date", { description: "新" })
    expect(updated.createdAt).toBe(created.createdAt)
  })

  it("updatedAtは作成時にcreatedAtと同じ時刻でfrontmatterのupdatedへ保存される", async () => {
    const project = await makeProject()
    const skill = await createSkill(project, { dirName: "fresh", description: "x", body: "" })
    expect(skill.updatedAt).toBeDefined()

    const content = await fs.readFile(path.join(project.path, "skills", "fresh", "SKILL.md"), "utf-8")
    expect(content).toContain("updated:")
  })

  it("updateSkillするたびにupdatedAtが更新される一方、createdAtは変わらない", async () => {
    const project = await makeProject()
    const created = await createSkill(project, { dirName: "touched", description: "旧", body: "" })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const updated = await updateSkill(project, "touched", { description: "新" })

    expect(updated.createdAt).toBe(created.createdAt)
    expect(updated.updatedAt).not.toBe(created.updatedAt)
    expect(new Date(updated.updatedAt!).getTime()).toBeGreaterThan(new Date(created.updatedAt!).getTime())
  })

  it("renameSkillしてもupdatedAtが更新される", async () => {
    const project = await makeProject()
    const created = await createSkill(project, { dirName: "old-name", description: "x", body: "" })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const renamed = await renameSkill(project, "old-name", "new-name")

    expect(renamed.updatedAt).not.toBe(created.updatedAt)
  })

  it("updatedフィールドが無い既存スキルは、fs.statのmtimeを暫定値として使う", async () => {
    const project = await makeProject()
    await fs.mkdir(path.join(project.path, "skills", "legacy-mtime"), { recursive: true })
    await fs.writeFile(
      path.join(project.path, "skills", "legacy-mtime", "SKILL.md"),
      "---\nname: legacy-mtime\ndescription: desc\n---\n\n本文\n"
    )
    const skill = await getSkill(project, "legacy-mtime")
    expect(skill?.updatedAt).toBeDefined()
  })

  it("createdフィールドが無い既存スキルは、fs.statのbirthtimeを暫定値として使う", async () => {
    const project = await makeProject()
    await fs.mkdir(path.join(project.path, "skills", "legacy"), { recursive: true })
    await fs.writeFile(
      path.join(project.path, "skills", "legacy", "SKILL.md"),
      "---\nname: legacy\ndescription: desc\n---\n\n本文\n"
    )
    const skill = await getSkill(project, "legacy")
    expect(skill?.createdAt).toBeDefined()
  })

  it("references/scripts/evalsサブフォルダの有無を検知する", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "plain", description: "x", body: "" })
    await createSkill(project, { dirName: "advanced", description: "x", body: "" })
    await fs.mkdir(path.join(project.path, "skills", "advanced", "references"), { recursive: true })
    await fs.mkdir(path.join(project.path, "skills", "advanced", "evals"), { recursive: true })

    const plain = await getSkill(project, "plain")
    expect(plain?.hasReferences).toBe(false)
    expect(plain?.hasScripts).toBe(false)
    expect(plain?.hasEvals).toBe(false)

    const advanced = await getSkill(project, "advanced")
    expect(advanced?.hasReferences).toBe(true)
    expect(advanced?.hasScripts).toBe(false)
    expect(advanced?.hasEvals).toBe(true)
  })

  it("削除するとディレクトリごと消える", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "removable", description: "x", body: "" })
    await deleteSkill(project, "removable")
    expect(await getSkill(project, "removable")).toBeNull()
  })

  it("存在しないスキルの更新・削除はエラーになる", async () => {
    const project = await makeProject()
    await expect(updateSkill(project, "unknown", { description: "x" })).rejects.toThrow()
    await expect(deleteSkill(project, "unknown")).rejects.toThrow()
  })

  it("dirNameにパストラバーサル文字列が含まれる更新・削除は拒否され、対象外ディレクトリに影響しない", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "victim", description: "被害想定", body: "" })

    const traversalNames = ["../victim", "..\\victim", "a/../../victim", "a/b"]
    for (const traversal of traversalNames) {
      await expect(updateSkill(project, traversal, { description: "x" })).rejects.toThrow()
      await expect(deleteSkill(project, traversal)).rejects.toThrow()
    }

    // 検証対象のディレクトリが実際に無傷であることを確認する
    expect(await getSkill(project, "victim")).toMatchObject({ description: "被害想定" })
  })
})

describe("renameSkill", () => {
  it("ディレクトリ名とSKILL.md内のnameフィールドの両方が変わる", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "task", description: "高負荷制作チーム", body: "# 手順" })

    const renamed = await renameSkill(project, "task", "autonomous-production-team")
    expect(renamed.dirName).toBe("autonomous-production-team")
    expect(renamed.name).toBe("autonomous-production-team")
    expect(renamed.description).toBe("高負荷制作チーム")
    expect(renamed.body).toBe("# 手順")

    expect(await getSkill(project, "task")).toBeNull()
    const content = await fs.readFile(
      path.join(project.path, "skills", "autonomous-production-team", "SKILL.md"),
      "utf-8"
    )
    expect(content).toContain("name: autonomous-production-team")
  })

  it("argument-schema等の未編集フィールドはリネーム後も保持される", async () => {
    const project = await makeProject()
    await fs.mkdir(path.join(project.path, "skills", "with-schema"), { recursive: true })
    await fs.writeFile(
      path.join(project.path, "skills", "with-schema", "SKILL.md"),
      "---\nname: with-schema\ndescription: desc\nargument-schema:\n  type: object\n---\n\n本文\n"
    )
    const renamed = await renameSkill(project, "with-schema", "renamed-schema")
    expect(renamed.argumentSchema).toMatchObject({ type: "object" })
  })

  it("変更後の名前が既に存在する場合はエラーになる", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "a", description: "x", body: "" })
    await createSkill(project, { dirName: "b", description: "y", body: "" })
    await expect(renameSkill(project, "a", "b")).rejects.toThrow()
  })

  it("不正な名前（日本語・スペース等）へのリネームは拒否する", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "valid", description: "x", body: "" })
    await expect(renameSkill(project, "valid", "不正な名前")).rejects.toThrow()
  })

  it("存在しないスキルのリネームはエラーになる", async () => {
    const project = await makeProject()
    await expect(renameSkill(project, "unknown", "new-name")).rejects.toThrow()
  })

  it("oldDirNameにパストラバーサル文字列が含まれる場合は拒否する", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "victim", description: "被害想定", body: "" })

    await expect(renameSkill(project, "../victim", "new-name")).rejects.toThrow()
    await expect(renameSkill(project, "a/../../victim", "new-name")).rejects.toThrow()

    expect(await getSkill(project, "victim")).toMatchObject({ description: "被害想定" })
  })
})
