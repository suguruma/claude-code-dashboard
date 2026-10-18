import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BACKUP_INFIX } from "./fileIO"
import { createSkill, disableSkill, listSkills, renameSkill, updateSkill } from "./skills"
import { ProjectConfig } from "./types"

// 退避の作成に失敗する状況を作るため、backupFile だけを差し替えられるようにする（ほかは本物）
const control = vi.hoisted(() => ({ failBackup: false }))
vi.mock("./fileIO", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fileIO")>()
  return {
    ...actual,
    backupFile: async (filePath: string) => {
      if (control.failBackup) throw new Error("退避に失敗しました（テスト）")
      return actual.backupFile(filePath)
    },
  }
})

const cleanupDirs: string[] = []

async function makeProject(): Promise<ProjectConfig> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-skills-backup-test-"))
  cleanupDirs.push(tmpDir)
  return { id: "test", name: "test", path: tmpDir }
}

/** スキルのフォルダ直下にある SKILL.md の退避ファイル名（古い順） */
async function skillBackups(dir: string): Promise<string[]> {
  const prefix = `SKILL.md${BACKUP_INFIX}`
  return (await fs.readdir(dir)).filter((n) => n.startsWith(prefix)).sort()
}

beforeEach(() => {
  control.failBackup = false
})

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("updateSkill: 書き換える前の退避", () => {
  it("更新のあと、スキルのフォルダに退避が1件でき、中身は更新前の SKILL.md と一致する", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "sample-skill", description: "更新前", body: "更新前の本文" })
    const dir = path.join(project.path, "skills", "sample-skill")
    const before = await fs.readFile(path.join(dir, "SKILL.md"), "utf-8")

    await updateSkill(project, "sample-skill", { description: "更新後", body: "更新後の本文" })

    const backups = await skillBackups(dir)
    expect(backups).toHaveLength(1)
    expect(await fs.readFile(path.join(dir, backups[0]), "utf-8")).toBe(before)
    expect(await fs.readFile(path.join(dir, "SKILL.md"), "utf-8")).toContain("更新後の本文")
  })

  it("無効化中のスキル（skills-disabled/）の編集でも、同じように退避される", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "sample-skill", description: "更新前", body: "更新前の本文" })
    await disableSkill(project, "sample-skill")
    const dir = path.join(project.path, "skills-disabled", "sample-skill")
    const before = await fs.readFile(path.join(dir, "SKILL.md"), "utf-8")

    await updateSkill(project, "sample-skill", { body: "更新後の本文" })

    const backups = await skillBackups(dir)
    expect(backups).toHaveLength(1)
    expect(await fs.readFile(path.join(dir, backups[0]), "utf-8")).toBe(before)
  })

  it("退避が作れないときは、SKILL.md を書き換えず、エラーになる", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "sample-skill", description: "更新前", body: "更新前の本文" })
    const dir = path.join(project.path, "skills", "sample-skill")
    const before = await fs.readFile(path.join(dir, "SKILL.md"), "utf-8")

    control.failBackup = true
    await expect(updateSkill(project, "sample-skill", { body: "更新後の本文" })).rejects.toThrow("退避に失敗")

    expect(await fs.readFile(path.join(dir, "SKILL.md"), "utf-8")).toBe(before)
    expect(await skillBackups(dir)).toHaveLength(0)
  })

  it("35回続けて更新しても、退避は30世代以内（保持方針）で、いちばん新しい退避は直前の内容", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "sample-skill", description: "d", body: "本文0" })
    const dir = path.join(project.path, "skills", "sample-skill")

    for (let i = 1; i <= 35; i++) await updateSkill(project, "sample-skill", { body: `本文${i}` })

    const backups = await skillBackups(dir)
    expect(backups.length).toBeLessThanOrEqual(30)
    expect(backups.length).toBeGreaterThanOrEqual(5)
    const newest = await fs.readFile(path.join(dir, backups[backups.length - 1]), "utf-8")
    expect(newest).toContain("本文34")
  })

  it("退避のファイルは、スキルの一覧に混ざらない", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "sample-skill", description: "d", body: "本文" })
    await updateSkill(project, "sample-skill", { body: "本文2" })

    const skills = await listSkills(project)
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({ dirName: "sample-skill", body: "本文2" })
  })
})

describe("renameSkill: 書き換える前の退避", () => {
  it("改名のあと、新しい名前のフォルダに退避が1件（改名前の内容）あり、旧名のフォルダは残らない", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "old-name", description: "d", body: "改名前の本文" })
    const oldDir = path.join(project.path, "skills", "old-name")
    const before = await fs.readFile(path.join(oldDir, "SKILL.md"), "utf-8")

    await renameSkill(project, "old-name", "new-name")

    const newDir = path.join(project.path, "skills", "new-name")
    const backups = await skillBackups(newDir)
    expect(backups).toHaveLength(1)
    expect(await fs.readFile(path.join(newDir, backups[0]), "utf-8")).toBe(before)
    await expect(fs.access(oldDir)).rejects.toThrow()
    expect(await fs.readFile(path.join(newDir, "SKILL.md"), "utf-8")).toContain("name: new-name")
  })

  it("退避が作れないときは、フォルダ名も SKILL.md も変わらず、エラーになる", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "old-name", description: "d", body: "改名前の本文" })
    const oldDir = path.join(project.path, "skills", "old-name")
    const before = await fs.readFile(path.join(oldDir, "SKILL.md"), "utf-8")

    control.failBackup = true
    await expect(renameSkill(project, "old-name", "new-name")).rejects.toThrow("退避に失敗")

    expect(await fs.readFile(path.join(oldDir, "SKILL.md"), "utf-8")).toBe(before)
    await expect(fs.access(path.join(project.path, "skills", "new-name"))).rejects.toThrow()
  })

  it("無効化中のスキルの改名でも、skills-disabled/ の新しい名前のフォルダに退避が残る", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "old-name", description: "d", body: "本文" })
    await disableSkill(project, "old-name")

    await renameSkill(project, "old-name", "new-name")

    expect(await skillBackups(path.join(project.path, "skills-disabled", "new-name"))).toHaveLength(1)
  })
})
