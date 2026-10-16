import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { archiveCurrentVersion, listArchivedVersions, restoreArchivedVersion } from "./skillArchive"
import { ProjectConfig } from "./types"

const cleanupDirs: string[] = []

async function makeProject(): Promise<ProjectConfig> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-skill-archive-test-"))
  cleanupDirs.push(tmpDir)
  return { id: "test", name: "test", path: tmpDir }
}

async function writeSkill(project: ProjectConfig, dirName: string, targetModel: string, body = "本文") {
  const dir = path.join(project.path, "skills", dirName)
  await fs.mkdir(dir, { recursive: true })
  const frontmatter = targetModel
    ? `---\nname: ${dirName}\ndescription: desc\ntarget-model: ${targetModel}\n---\n\n${body}\n`
    : `---\nname: ${dirName}\ndescription: desc\n---\n\n${body}\n`
  await fs.writeFile(path.join(dir, "SKILL.md"), frontmatter)
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("listArchivedVersions", () => {
  it("アーカイブディレクトリが無ければ空配列を返す", async () => {
    const project = await makeProject()
    expect(await listArchivedVersions(project, "my-skill")).toEqual([])
  })

  it("アーカイブ済みのモデル別バージョンを列挙する", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5")
    await archiveCurrentVersion(project, "my-skill")
    await writeSkill(project, "my-skill", "Sonnet 5")
    await archiveCurrentVersion(project, "my-skill")

    const versions = await listArchivedVersions(project, "my-skill")
    expect(versions.map((v) => v.model).sort()).toEqual(["Opus 5", "Sonnet 5"])
  })
})

describe("archiveCurrentVersion", () => {
  it("現在のバージョンをコピーし、アクティブ版はそのまま残す", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5")
    await archiveCurrentVersion(project, "my-skill")

    const activeExists = await fs
      .access(path.join(project.path, "skills", "my-skill", "SKILL.md"))
      .then(() => true)
      .catch(() => false)
    expect(activeExists).toBe(true)

    const archivedExists = await fs
      .access(path.join(project.path, "skills-archive", "Opus 5", "my-skill", "SKILL.md"))
      .then(() => true)
      .catch(() => false)
    expect(archivedExists).toBe(true)
  })

  it("存在しないスキルはエラーになる", async () => {
    const project = await makeProject()
    await expect(archiveCurrentVersion(project, "nope")).rejects.toThrow("スキルが見つかりません")
  })

  it("同じモデルへの再アーカイブは既存アーカイブを.ccd-backupとして退避する", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5", "v1")
    await archiveCurrentVersion(project, "my-skill")
    await writeSkill(project, "my-skill", "Opus 5", "v2")
    await archiveCurrentVersion(project, "my-skill")

    const archiveDir = path.join(project.path, "skills-archive", "Opus 5")
    const entries = await fs.readdir(archiveDir)
    expect(entries.some((e) => e.startsWith("my-skill.ccd-backup."))).toBe(true)
    const latest = await fs.readFile(path.join(archiveDir, "my-skill", "SKILL.md"), "utf-8")
    expect(latest).toContain("v2")
  })
})

describe("restoreArchivedVersion", () => {
  it("アクティブ版を退避し、アーカイブ版をアクティブへコピーする", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5", "opus-content")
    await archiveCurrentVersion(project, "my-skill")
    await writeSkill(project, "my-skill", "Sonnet 5", "sonnet-content")

    await restoreArchivedVersion(project, "my-skill", "Opus 5")

    const active = await fs.readFile(
      path.join(project.path, "skills", "my-skill", "SKILL.md"),
      "utf-8"
    )
    expect(active).toContain("opus-content")

    // 退避された旧アクティブ版（Sonnet 5）がアーカイブに残っている
    const archivedSonnet = await fs.readFile(
      path.join(project.path, "skills-archive", "Sonnet 5", "my-skill", "SKILL.md"),
      "utf-8"
    )
    expect(archivedSonnet).toContain("sonnet-content")

    // 復元元のアーカイブ（Opus 5）自体は保持されたまま（再切替に備える）
    const archivedOpus = await fs.readFile(
      path.join(project.path, "skills-archive", "Opus 5", "my-skill", "SKILL.md"),
      "utf-8"
    )
    expect(archivedOpus).toContain("opus-content")
  })

  it("同一モデルへの復元（編集前の状態に戻す）も安全に動作する", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5", "original")
    await archiveCurrentVersion(project, "my-skill")
    await writeSkill(project, "my-skill", "Opus 5", "edited")

    await restoreArchivedVersion(project, "my-skill", "Opus 5")

    const active = await fs.readFile(
      path.join(project.path, "skills", "my-skill", "SKILL.md"),
      "utf-8"
    )
    expect(active).toContain("original")
  })

  it("アーカイブに存在しないモデルを指定するとエラーになる", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5")
    await expect(restoreArchivedVersion(project, "my-skill", "Opus 6")).rejects.toThrow(
      "指定されたモデルのアーカイブが見つかりません"
    )
  })

  it("アクティブ版が存在しない状態からの復元（新規インストール相当）にも対応する", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5", "archived-only")
    await archiveCurrentVersion(project, "my-skill")
    await fs.rm(path.join(project.path, "skills", "my-skill"), { recursive: true, force: true })

    await restoreArchivedVersion(project, "my-skill", "Opus 5")

    const active = await fs.readFile(
      path.join(project.path, "skills", "my-skill", "SKILL.md"),
      "utf-8"
    )
    expect(active).toContain("archived-only")
  })
})
