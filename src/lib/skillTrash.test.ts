import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { RETENTION_MAX_AGE_DAYS } from "./retention"
import { createSkill, deleteSkill, disableSkill, getSkill, listSkills } from "./skills"
import { listTrashedSkills, moveSkillToTrash, pruneSkillTrash, restoreTrashedSkill, skillTrashDir } from "./skillTrash"
import { ProjectConfig } from "./types"

const cleanupDirs: string[] = []

async function makeProject(): Promise<ProjectConfig> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-skilltrash-test-"))
  cleanupDirs.push(tmpDir)
  return { id: "test", name: "test", path: tmpDir }
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("削除したスキルの退避と一覧", () => {
  it("退避先は skills/ の外(Claude Codeが読み込む範囲の外)にある", async () => {
    const project = await makeProject()
    const skillsRoot = path.join(project.path, "skills")
    expect(path.relative(skillsRoot, skillTrashDir(project)).startsWith("..")).toBe(true)
    expect(path.basename(skillTrashDir(project))).toBe("skills-trash")
  })

  it("削除したスキルが一覧に出て、名前・削除日時・退避先が分かる。skills/ の一覧には出ない", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "gone", description: "説明文", body: "本文", title: "消すスキル" })
    await deleteSkill(project, "gone")

    const items = await listTrashedSkills(project)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ dirName: "gone", wasEnabled: true, title: "消すスキル", description: "説明文" })
    expect(items[0].id).toMatch(/^gone-\d{8}-\d{6}$/)
    expect(items[0].path).toBe(path.join(skillTrashDir(project), items[0].id))
    expect(Number.isNaN(new Date(items[0].deletedAt).getTime())).toBe(false)
    expect(await listSkills(project)).toEqual([])
  })

  it("退避フォルダが無ければ空の一覧を返す", async () => {
    expect(await listTrashedSkills(await makeProject())).toEqual([])
  })

  it("同じスキルを同じ秒に続けて削除しても、別々に退避される(上書きしない)", async () => {
    const project = await makeProject()
    const sameSecond = new Date(2026, 9, 18, 12, 0, 0)
    for (const body of ["一回目", "二回目"]) {
      await createSkill(project, { dirName: "dup", description: "x", body })
      const dir = path.join(project.path, "skills", "dup")
      await moveSkillToTrash(project, "dup", dir, true, sameSecond)
    }
    const ids = (await fs.readdir(skillTrashDir(project))).sort()
    expect(ids).toEqual(["dup-20261018-120000", "dup-20261018-120000-2"])
    const bodies = await Promise.all(
      ids.map((id) => fs.readFile(path.join(skillTrashDir(project), id, "SKILL.md"), "utf-8"))
    )
    expect(bodies.some((b) => b.includes("一回目"))).toBe(true)
    expect(bodies.some((b) => b.includes("二回目"))).toBe(true)
  })

  it("記録ファイルが無い退避(手で移した等)も、フォルダ名から名前と日時を推定して一覧に出す", async () => {
    const project = await makeProject()
    const dir = path.join(skillTrashDir(project), "manual-20260101-090000")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "SKILL.md"), "---\nname: manual\ndescription: d\n---\n本文")

    const items = await listTrashedSkills(project)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ dirName: "manual", wasEnabled: true })
    expect(new Date(items[0].deletedAt).getFullYear()).toBe(2026)
  })
})

describe("restoreTrashedSkill", () => {
  it("削除済みスキルを skills/ に戻せる(本文・付属ファイルも元のまま、退避は一覧から消える)", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "back", description: "説明", body: "元の本文" })
    await fs.mkdir(path.join(project.path, "skills", "back", "scripts"), { recursive: true })
    await fs.writeFile(path.join(project.path, "skills", "back", "scripts", "run.sh"), "echo hi")
    await deleteSkill(project, "back")
    const [item] = await listTrashedSkills(project)

    const result = await restoreTrashedSkill(project, item.id)

    expect(result).toEqual({ dirName: "back", enabled: true })
    expect(await getSkill(project, "back")).toMatchObject({ description: "説明", body: "元の本文", enabled: true })
    expect(await fs.readFile(path.join(project.path, "skills", "back", "scripts", "run.sh"), "utf-8")).toBe("echo hi")
    expect(await listTrashedSkills(project)).toEqual([])
    // 退避の記録ファイルはスキルのフォルダに残さない
    expect(await fs.readdir(path.join(project.path, "skills", "back"))).not.toContain(".ccd-trash.json")
  })

  it("削除したときに無効だったスキルは、無効のまま(skills-disabled/)に戻す", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "sleepy", description: "x", body: "" })
    await disableSkill(project, "sleepy")
    await deleteSkill(project, "sleepy")
    const [item] = await listTrashedSkills(project)
    expect(item.wasEnabled).toBe(false)

    expect(await restoreTrashedSkill(project, item.id)).toEqual({ dirName: "sleepy", enabled: false })
    expect(await getSkill(project, "sleepy")).toMatchObject({ enabled: false })
  })

  it("同名のスキルが既にあるときは、上書きせずエラーにする(退避は残る)", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "clash", description: "古い", body: "古い本文" })
    await deleteSkill(project, "clash")
    await createSkill(project, { dirName: "clash", description: "新しい", body: "新しい本文" })
    const [item] = await listTrashedSkills(project)

    await expect(restoreTrashedSkill(project, item.id)).rejects.toThrow("既に存在")

    expect(await getSkill(project, "clash")).toMatchObject({ description: "新しい" })
    expect(await listTrashedSkills(project)).toHaveLength(1)
  })

  it("一覧に無いIDやパス区切りを含むIDは拒否する", async () => {
    const project = await makeProject()
    await expect(restoreTrashedSkill(project, "nothing-20260101-000000")).rejects.toThrow("見つかりません")
    for (const bad of ["../x", "a/b", "a\\b", ""]) {
      await expect(restoreTrashedSkill(project, bad)).rejects.toThrow("不正な指定")
    }
  })
})

describe("pruneSkillTrash (保持方針)", () => {
  async function makeAged(project: ProjectConfig, dirName: string, daysAgo: number, nowMs: number) {
    const deleted = new Date(nowMs - daysAgo * 24 * 60 * 60 * 1000)
    const id = `${dirName}-d${daysAgo}`
    const dir = path.join(skillTrashDir(project), id)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "SKILL.md"), "---\nname: x\ndescription: d\n---\n")
    await fs.writeFile(
      path.join(dir, ".ccd-trash.json"),
      JSON.stringify({ dirName, deletedAt: deleted.toISOString(), wasEnabled: true })
    )
    return id
  }

  it("期間を超えた古い退避だけを削除し、新しいものは残す(同じスキルの直近分は期間を超えても残る)", async () => {
    const project = await makeProject()
    const now = Date.now()
    const keepIds: string[] = []
    // 直近の5世代(期間内)+ 期間を超えた古い2世代
    for (const d of [0, 1, 2, 3, 4]) keepIds.push(await makeAged(project, "tidy", d, now))
    const oldIds = [
      await makeAged(project, "tidy", RETENTION_MAX_AGE_DAYS + 10, now),
      await makeAged(project, "tidy", RETENTION_MAX_AGE_DAYS + 20, now),
    ]
    // 別のスキルは、古くても最新の1世代は残る
    const lonely = await makeAged(project, "lonely", RETENTION_MAX_AGE_DAYS + 50, now)

    const removed = await pruneSkillTrash(project, now)

    expect(removed.sort()).toEqual(oldIds.sort())
    const remaining = await fs.readdir(skillTrashDir(project))
    for (const id of [...keepIds, lonely]) expect(remaining).toContain(id)
    for (const id of oldIds) expect(remaining).not.toContain(id)
  })

  it("削除のたびに自動で整理される(古い退避が積み上がらない)", async () => {
    const project = await makeProject()
    const now = Date.now()
    for (const d of [0, 1, 2, 3, 4]) await makeAged(project, "auto", d, now)
    const stale = await makeAged(project, "auto", RETENTION_MAX_AGE_DAYS + 5, now)

    await createSkill(project, { dirName: "auto", description: "x", body: "" })
    await deleteSkill(project, "auto")

    expect(await fs.readdir(skillTrashDir(project))).not.toContain(stale)
  })
})
