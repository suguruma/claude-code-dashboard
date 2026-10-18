import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { listBackups } from "./backups"
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

describe("切り替え前の自動退避と、SKILL.md の退避の引き継ぎ", () => {
  const BACKUP_TS = 1_800_000_000_000
  const activeDir = (project: ProjectConfig) => path.join(project.path, "skills", "my-skill")
  const readActive = (project: ProjectConfig) => fs.readFile(path.join(activeDir(project), "SKILL.md"), "utf-8")
  const autoBackups = async (project: ProjectConfig) =>
    (await listArchivedVersions(project, "my-skill")).filter((v) => v.switchBackupAt !== undefined)

  it("同じモデルへ切り替えると、切り替え前の今の内容が「切り替え前の自動退避」としてアーカイブ一覧に出る（モデル別のアーカイブはそのまま）", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5", "original")
    await archiveCurrentVersion(project, "my-skill")
    await writeSkill(project, "my-skill", "Opus 5", "edited")

    await restoreArchivedVersion(project, "my-skill", "Opus 5")

    const versions = await listArchivedVersions(project, "my-skill")
    expect(versions.map((v) => [v.model, v.switchBackupAt !== undefined])).toEqual([
      ["Opus 5", false],
      ["Opus 5", true],
    ])
    const autos = await autoBackups(project)
    const snapshot = path.join(project.path, "skills-archive", "Opus 5", `my-skill.switch-backup.${autos[0].switchBackupAt}`, "SKILL.md")
    expect(await fs.readFile(snapshot, "utf-8")).toContain("edited")
    // モデル別のアーカイブは上書きされない
    const archived = await fs.readFile(path.join(project.path, "skills-archive", "Opus 5", "my-skill", "SKILL.md"), "utf-8")
    expect(archived).toContain("original")
    expect(await readActive(project)).toContain("original")
  })

  it("自動退避を指定して切り替えると、編集した内容が戻る。そのときの内容も、新しい自動退避として残る", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5", "original")
    await archiveCurrentVersion(project, "my-skill")
    await writeSkill(project, "my-skill", "Opus 5", "edited")
    await restoreArchivedVersion(project, "my-skill", "Opus 5")
    const [first] = await autoBackups(project)

    await restoreArchivedVersion(project, "my-skill", "Opus 5", first.switchBackupAt)

    expect(await readActive(project)).toContain("edited")
    const autos = await autoBackups(project)
    expect(autos).toHaveLength(2)
    // モデル別のアーカイブ（original）は、自動退避から戻しても上書きされない
    const archived = await fs.readFile(path.join(project.path, "skills-archive", "Opus 5", "my-skill", "SKILL.md"), "utf-8")
    expect(archived).toContain("original")
    const newest = [...autos].sort((a, b) => b.switchBackupAt! - a.switchBackupAt!)[0]
    const snapshot = path.join(project.path, "skills-archive", "Opus 5", `my-skill.switch-backup.${newest.switchBackupAt}`, "SKILL.md")
    expect(await fs.readFile(snapshot, "utf-8")).toContain("original")
  })

  it("別のモデルへ切り替えるときは、自動退避は作らず、現在の内容が現在のモデルのアーカイブとして一覧に出る", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5", "opus-content")
    await archiveCurrentVersion(project, "my-skill")
    await writeSkill(project, "my-skill", "Sonnet 5", "sonnet-content")

    await restoreArchivedVersion(project, "my-skill", "Opus 5")

    expect(await autoBackups(project)).toEqual([])
    expect((await listArchivedVersions(project, "my-skill")).map((v) => v.model).sort()).toEqual(["Opus 5", "Sonnet 5"])
  })

  it("切り替えのあとも、スキルのフォルダの SKILL.md.ccd-backup.* は残り、バックアップ画面（listBackups）に出る（同じモデル・別のモデルの両方）", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5", "original")
    await archiveCurrentVersion(project, "my-skill")
    await writeSkill(project, "my-skill", "Opus 5", "edited")
    await fs.writeFile(path.join(activeDir(project), `SKILL.md.ccd-backup.${BACKUP_TS}`), "編集前の退避")

    await restoreArchivedVersion(project, "my-skill", "Opus 5") // 同じモデル
    let backups = await listBackups(project)
    expect(backups.map((b) => [b.location, b.fileName])).toEqual([["skills/my-skill", `SKILL.md.ccd-backup.${BACKUP_TS}`]])
    expect(await fs.readFile(path.join(activeDir(project), `SKILL.md.ccd-backup.${BACKUP_TS}`), "utf-8")).toBe("編集前の退避")

    await writeSkill(project, "my-skill", "Sonnet 5", "sonnet-content")
    await restoreArchivedVersion(project, "my-skill", "Opus 5") // 別のモデル
    backups = await listBackups(project)
    expect(backups.map((b) => b.fileName)).toEqual([`SKILL.md.ccd-backup.${BACKUP_TS}`])
  })

  it("SKILL.md の退避は、アーカイブ・自動退避のフォルダへ複製されない。アーカイブに古い退避が紛れていても、切り替えで持ち込まれない", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5", "original")
    await fs.writeFile(path.join(activeDir(project), `SKILL.md.ccd-backup.${BACKUP_TS}`), "退避A")
    await archiveCurrentVersion(project, "my-skill")
    const archivedDir = path.join(project.path, "skills-archive", "Opus 5", "my-skill")
    expect(await fs.readdir(archivedDir)).toEqual(["SKILL.md"])

    // 古いアーカイブ（④の前に作られたもの）に退避が紛れている状況
    await fs.writeFile(path.join(archivedDir, `SKILL.md.ccd-backup.${BACKUP_TS + 5}`), "古い退避")
    await writeSkill(project, "my-skill", "Opus 5", "edited")
    await restoreArchivedVersion(project, "my-skill", "Opus 5")

    expect((await fs.readdir(activeDir(project))).sort()).toEqual([`SKILL.md.ccd-backup.${BACKUP_TS}`, "SKILL.md"].sort())
    const [auto] = await autoBackups(project)
    const snapshotDir = path.join(project.path, "skills-archive", "Opus 5", `my-skill.switch-backup.${auto.switchBackupAt}`)
    expect(await fs.readdir(snapshotDir)).toEqual(["SKILL.md"])
  })

  it("切り替えで、アクティブ側の SKILL.md 以外のファイル・フォルダも、切り替え先のものに入れ替わる", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5", "original")
    await fs.mkdir(path.join(activeDir(project), "references"))
    await fs.writeFile(path.join(activeDir(project), "references", "a.md"), "旧")
    await archiveCurrentVersion(project, "my-skill")
    await fs.rm(path.join(activeDir(project), "references"), { recursive: true })
    await fs.mkdir(path.join(activeDir(project), "scripts"))
    await fs.writeFile(path.join(activeDir(project), "scripts", "b.sh"), "新")

    await restoreArchivedVersion(project, "my-skill", "Opus 5")

    expect((await fs.readdir(activeDir(project))).sort()).toEqual(["SKILL.md", "references"])
    const [auto] = await autoBackups(project)
    const snapshotDir = path.join(project.path, "skills-archive", "Opus 5", `my-skill.switch-backup.${auto.switchBackupAt}`)
    expect((await fs.readdir(snapshotDir)).sort()).toEqual(["SKILL.md", "scripts"])
  })

  it("不正な自動退避の指定（桁が足りない・数値でない）は拒否し、存在しない時刻は「見つかりません」", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5", "original")
    await archiveCurrentVersion(project, "my-skill")

    for (const bad of [1, 123, -5, 1.5, Number.NaN]) {
      await expect(restoreArchivedVersion(project, "my-skill", "Opus 5", bad)).rejects.toThrow("不正な退避の指定です")
    }
    await expect(restoreArchivedVersion(project, "my-skill", "Opus 5", BACKUP_TS)).rejects.toThrow("見つかりません")
    expect(await readActive(project)).toContain("original")
  })

  it("スキル名にパス区切り・.・..・空があると拒否する（アーカイブの一覧・作成・切り替え）。半角英数字以外の名前は拒否しない", async () => {
    const project = await makeProject()
    for (const bad of ["../x", "a/b", "a\\b", "", ".", ".."]) {
      await expect(listArchivedVersions(project, bad)).rejects.toThrow("不正なスキル名です")
      await expect(archiveCurrentVersion(project, bad)).rejects.toThrow("不正なスキル名です")
      await expect(restoreArchivedVersion(project, bad, "Opus 5")).rejects.toThrow("不正なスキル名です")
    }
    // ダッシュボードの外で作られた、ドットや日本語を含む名前のスキルも、アーカイブできる
    await writeSkill(project, "my.skill-日本語", "Opus 5", "本文")
    await archiveCurrentVersion(project, "my.skill-日本語")
    expect((await listArchivedVersions(project, "my.skill-日本語")).map((v) => v.model)).toEqual(["Opus 5"])
  })
})
