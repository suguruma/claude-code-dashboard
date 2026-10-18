import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BACKUP_INFIX } from "./fileIO"
import { SWITCH_BACKUP_INFIX, archiveCurrentVersion, listArchivedVersions, restoreArchivedVersion } from "./skillArchive"
import { ProjectConfig } from "./types"

// 整理が失敗する状況を作るため、pruneDirBackups だけを差し替えられるようにする（ほかは本物）
const control = vi.hoisted(() => ({ failPrune: false }))
vi.mock("./fileIO", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fileIO")>()
  return {
    ...actual,
    pruneDirBackups: async (...args: Parameters<typeof actual.pruneDirBackups>) => {
      if (control.failPrune) throw new Error("整理に失敗しました（テスト）")
      return actual.pruneDirBackups(...args)
    },
  }
})

const cleanupDirs: string[] = []
/** 90日より十分に古い時刻（2023年） */
const OLD_TS = 1_700_000_000_000

async function makeProject(): Promise<ProjectConfig> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-skill-archive-retention-test-"))
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

/** skills-archive/<モデル>/ の中にある、`<名前>.ccd-backup.<数字>`（infix を渡せば `.switch-backup.` など）のフォルダ名 */
async function dirBackups(project: ProjectConfig, model: string, dirName: string, infix = BACKUP_INFIX): Promise<string[]> {
  const parent = path.join(project.path, "skills-archive", model)
  const prefix = `${dirName}${infix}`
  return (await fs.readdir(parent)).filter((n) => n.startsWith(prefix)).sort()
}

/** 古い退避フォルダを count 個作る（名前は <名前>.ccd-backup.<OLD_TS+i>。infix を渡せば `.switch-backup.` など） */
async function seedOldBackups(project: ProjectConfig, model: string, dirName: string, count: number, infix = BACKUP_INFIX) {
  const parent = path.join(project.path, "skills-archive", model)
  for (let i = 0; i < count; i++) {
    const dir = path.join(parent, `${dirName}${infix}${OLD_TS + i}`)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "SKILL.md"), `古い退避${i}`)
  }
}

beforeEach(() => {
  control.failPrune = false
})

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("アーカイブの退避フォルダ(.ccd-backup.<epoch>)の整理", () => {
  it("35回上書きしても、退避フォルダは30世代以内。本体と、ほかのスキル・ほかのモデルの退避フォルダは消えない", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5")
    await seedOldBackups(project, "Opus 5", "other-skill", 40)
    await seedOldBackups(project, "Sonnet 5", "my-skill", 40)

    for (let i = 0; i < 35; i++) await archiveCurrentVersion(project, "my-skill")

    expect(await dirBackups(project, "Opus 5", "my-skill")).toHaveLength(30)
    // 本体は残っている
    await fs.access(path.join(project.path, "skills-archive", "Opus 5", "my-skill", "SKILL.md"))
    // ほかのスキル・ほかのモデルの退避フォルダには触れない
    expect(await dirBackups(project, "Opus 5", "other-skill")).toHaveLength(40)
    expect(await dirBackups(project, "Sonnet 5", "my-skill")).toHaveLength(40)
  })

  it("残るのは新しい順。90日より古い退避は、直近5世代を除いて消える", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5")
    await archiveCurrentVersion(project, "my-skill")
    await seedOldBackups(project, "Opus 5", "my-skill", 10)

    await archiveCurrentVersion(project, "my-skill")

    const remaining = await dirBackups(project, "Opus 5", "my-skill")
    // 新しい退避1件 + 直近5世代のうち残りの4件（古い退避のうち新しい順の4件）
    expect(remaining).toHaveLength(5)
    const stamps = remaining.map((n) => Number(n.slice(`my-skill${BACKUP_INFIX}`.length)))
    expect(stamps.filter((t) => t > OLD_TS + 1000)).toHaveLength(1)
    expect(stamps.filter((t) => t <= OLD_TS + 9).sort((a, b) => a - b)).toEqual([OLD_TS + 6, OLD_TS + 7, OLD_TS + 8, OLD_TS + 9])
  })

  it("同じモデルへの切り替えが作る「切り替え前の自動退避」(.switch-backup.)も、整理の対象になる。.ccd-backup. のフォルダには触れない", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5", "アーカイブ版")
    await archiveCurrentVersion(project, "my-skill")
    await writeSkill(project, "my-skill", "Opus 5", "編集後")
    await seedOldBackups(project, "Opus 5", "my-skill", 35, SWITCH_BACKUP_INFIX)
    await seedOldBackups(project, "Opus 5", "my-skill", 7)

    await restoreArchivedVersion(project, "my-skill", "Opus 5")

    // 自動退避は、新しい1件 + 古い4件（直近5世代）。古い順に消える
    const autos = await dirBackups(project, "Opus 5", "my-skill", SWITCH_BACKUP_INFIX)
    expect(autos).toHaveLength(5)
    const stamps = autos.map((n) => Number(n.slice(`my-skill${SWITCH_BACKUP_INFIX}`.length)))
    expect(stamps.filter((t) => t > OLD_TS + 1000)).toHaveLength(1)
    expect(stamps.filter((t) => t <= OLD_TS + 34).sort((a, b) => a - b)).toEqual([OLD_TS + 31, OLD_TS + 32, OLD_TS + 33, OLD_TS + 34])
    // 画面から戻せる自動退避として、アーカイブ一覧にも出る
    expect((await listArchivedVersions(project, "my-skill")).filter((v) => v.switchBackupAt !== undefined)).toHaveLength(5)
    // 上書きの退避フォルダ(.ccd-backup.)は、この操作では整理されない
    expect(await dirBackups(project, "Opus 5", "my-skill")).toHaveLength(7)
    const active = await fs.readFile(path.join(project.path, "skills", "my-skill", "SKILL.md"), "utf-8")
    expect(active).toContain("アーカイブ版")
  })

  it("同じモデルへ35回切り替えても、自動退避は30世代以内。ほかのスキルの自動退避には触れない", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5", "アーカイブ版")
    await archiveCurrentVersion(project, "my-skill")
    await seedOldBackups(project, "Opus 5", "other-skill", 40, SWITCH_BACKUP_INFIX)

    for (let i = 0; i < 35; i++) await restoreArchivedVersion(project, "my-skill", "Opus 5")

    expect(await dirBackups(project, "Opus 5", "my-skill", SWITCH_BACKUP_INFIX)).toHaveLength(30)
    expect(await dirBackups(project, "Opus 5", "other-skill", SWITCH_BACKUP_INFIX)).toHaveLength(40)
    await fs.access(path.join(project.path, "skills-archive", "Opus 5", "my-skill", "SKILL.md"))
  })

  it("切り替え先の自動退避が、整理で消える古さ（31世代目）でも、切り替え自体は成功する（整理は最後に行う）", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5", "アーカイブ版")
    await archiveCurrentVersion(project, "my-skill")
    await seedOldBackups(project, "Opus 5", "my-skill", 35, SWITCH_BACKUP_INFIX)

    await restoreArchivedVersion(project, "my-skill", "Opus 5", OLD_TS)

    const active = await fs.readFile(path.join(project.path, "skills", "my-skill", "SKILL.md"), "utf-8")
    expect(active).toContain("古い退避0")
  })

  it("別のモデルへの復元で作る退避フォルダも、整理の対象になる", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Sonnet 5", "Sonnet版")
    await archiveCurrentVersion(project, "my-skill")
    await writeSkill(project, "my-skill", "Opus 5", "Opus版")
    await archiveCurrentVersion(project, "my-skill")
    // 現在のアクティブ(Opus 5)の退避先 skills-archive/Opus 5/my-skill が既にあるので、復元で退避フォルダができる
    await seedOldBackups(project, "Opus 5", "my-skill", 35)

    await restoreArchivedVersion(project, "my-skill", "Sonnet 5")

    expect(await dirBackups(project, "Opus 5", "my-skill")).toHaveLength(5)
  })

  it("整理が失敗しても、上書き・復元は成功する", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5", "アーカイブ版")
    await archiveCurrentVersion(project, "my-skill")
    await writeSkill(project, "my-skill", "Opus 5", "編集後")

    control.failPrune = true
    await archiveCurrentVersion(project, "my-skill") // 上書き（退避フォルダを作る）
    await restoreArchivedVersion(project, "my-skill", "Opus 5") // 同一モデルへの復元

    const active = await fs.readFile(path.join(project.path, "skills", "my-skill", "SKILL.md"), "utf-8")
    expect(active).toContain("編集後")
    // 上書きで作った退避フォルダ(.ccd-backup.)と、切り替えで作った自動退避(.switch-backup.)が、整理されないまま残る
    expect(await dirBackups(project, "Opus 5", "my-skill")).toHaveLength(1)
    expect(await dirBackups(project, "Opus 5", "my-skill", SWITCH_BACKUP_INFIX)).toHaveLength(1)
  })

  it("同じミリ秒に続けて上書きしても、別の世代の退避フォルダになる（既存のフォルダへ混ざらない）", async () => {
    const project = await makeProject()
    await writeSkill(project, "my-skill", "Opus 5")
    const spy = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000)
    try {
      await archiveCurrentVersion(project, "my-skill")
      await archiveCurrentVersion(project, "my-skill")
      await archiveCurrentVersion(project, "my-skill")
    } finally {
      spy.mockRestore()
    }

    expect(await dirBackups(project, "Opus 5", "my-skill")).toHaveLength(2)
  })
})
