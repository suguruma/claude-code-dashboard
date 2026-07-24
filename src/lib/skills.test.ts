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
})
