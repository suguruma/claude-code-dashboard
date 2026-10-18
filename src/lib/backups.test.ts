import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { listBackups, restoreBackup } from "./backups"
import { applyImport } from "./exportImport"
import { createSkill, renameSkill, updateSkill } from "./skills"
import { ExportBundle, ProjectConfig } from "./types"

const cleanupDirs: string[] = []

async function makeProject(): Promise<ProjectConfig> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-backups-test-"))
  cleanupDirs.push(tmpDir)
  return { id: "test", name: "test", path: tmpDir }
}

/**
 * restoreBackupは`.claude.json`をproject.pathの1つ上（親）に見に行くため、
 * 親ディレクトリごと制御下に置けるよう project.path を `<tmp>/.claude` にする。
 */
async function makeGlobalLikeProject(): Promise<ProjectConfig> {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-backups-global-test-"))
  cleanupDirs.push(parent)
  const claudeDir = path.join(parent, ".claude")
  await fs.mkdir(claudeDir, { recursive: true })
  return { id: "test", name: "test", path: claudeDir }
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("listBackups", () => {
  it("backupsディレクトリが無ければ空配列を返す", async () => {
    const project = await makeProject()
    expect(await listBackups(project)).toEqual([])
  })

  it("ファイル名末尾のUnixタイムスタンプ(ms)を抽出し、新しい順に並べる", async () => {
    const project = await makeProject()
    const backupsDir = path.join(project.path, "backups")
    await fs.mkdir(backupsDir, { recursive: true })
    await fs.writeFile(path.join(backupsDir, ".claude.json.backup.1700000000000"), "old")
    await fs.writeFile(path.join(backupsDir, ".claude.json.backup.1800000000000"), "new")

    const backups = await listBackups(project)
    expect(backups.map((b) => b.timestampMs)).toEqual([1800000000000, 1700000000000])
  })

  it("タイムスタンプが抽出できないファイルはnullとして扱う", async () => {
    const project = await makeProject()
    const backupsDir = path.join(project.path, "backups")
    await fs.mkdir(backupsDir, { recursive: true })
    await fs.writeFile(path.join(backupsDir, "unknown-format.txt"), "x")

    const backups = await listBackups(project)
    expect(backups[0].timestampMs).toBeNull()
  })
})

describe("restoreBackup", () => {
  it("指定したバックアップの内容で.claude.json（project.pathの1つ上）を上書きする", async () => {
    const project = await makeGlobalLikeProject()
    const backupsDir = path.join(project.path, "backups")
    await fs.mkdir(backupsDir, { recursive: true })
    await fs.writeFile(path.join(backupsDir, ".claude.json.backup.1800000000000"), '{"restored":true}')

    const claudeJsonPath = path.join(path.dirname(project.path), ".claude.json")
    await fs.writeFile(claudeJsonPath, '{"restored":false}')

    await restoreBackup(project, ".claude.json.backup.1800000000000")

    const restored = JSON.parse(await fs.readFile(claudeJsonPath, "utf-8"))
    expect(restored).toEqual({ restored: true })
  })

  it("復元前の.claude.jsonを.ccd-backup.<epoch>として退避する", async () => {
    const project = await makeGlobalLikeProject()
    const backupsDir = path.join(project.path, "backups")
    await fs.mkdir(backupsDir, { recursive: true })
    await fs.writeFile(path.join(backupsDir, ".claude.json.backup.1800000000000"), '{"restored":true}')

    const claudeJsonPath = path.join(path.dirname(project.path), ".claude.json")
    await fs.writeFile(claudeJsonPath, '{"restored":false}')

    await restoreBackup(project, ".claude.json.backup.1800000000000")

    const parentFiles = await fs.readdir(path.dirname(project.path))
    expect(parentFiles.some((f) => f.startsWith(".claude.json.ccd-backup."))).toBe(true)
  })

  it("一覧に無いファイル名を指定するとエラーになる", async () => {
    const project = await makeGlobalLikeProject()
    await expect(restoreBackup(project, ".claude.json.backup.9999999999999")).rejects.toThrow(
      "見つかりません"
    )
  })

  it("パス区切り文字を含むファイル名は拒否する（パストラバーサル対策）", async () => {
    const project = await makeGlobalLikeProject()
    await expect(restoreBackup(project, "../../.claude.json")).rejects.toThrow("不正なファイル名です")
  })
})

describe("ダッシュボードの退避(.ccd-backup.<epoch>)の一覧と復元", () => {
  const BACKUP_TS = 1_800_000_000_000

  it("プロジェクト直下の退避(CLAUDE.md・execution_log.json等)が、kind=ccd・元のファイル名つきで一覧に出る", async () => {
    const project = await makeProject()
    await fs.writeFile(path.join(project.path, `CLAUDE.md.ccd-backup.${BACKUP_TS}`), "旧CLAUDE")
    await fs.writeFile(path.join(project.path, `execution_log.json.ccd-backup.${BACKUP_TS + 1000}`), "旧ログ")
    await fs.writeFile(path.join(project.path, "CLAUDE.md"), "現在")

    const backups = await listBackups(project)

    expect(backups.map((b) => [b.kind, b.originalName, b.timestampMs])).toEqual([
      ["ccd", "execution_log.json", BACKUP_TS + 1000],
      ["ccd", "CLAUDE.md", BACKUP_TS],
    ])
  })

  it("Claude Code自身のbackups/と、ダッシュボードの退避が一緒に新しい順で並ぶ", async () => {
    const project = await makeProject()
    await fs.mkdir(path.join(project.path, "backups"))
    await fs.writeFile(path.join(project.path, "backups", ".claude.json.backup.1700000000000"), "{}")
    await fs.writeFile(path.join(project.path, `settings.json.ccd-backup.${BACKUP_TS}`), "{}")

    const backups = await listBackups(project)

    expect(backups.map((b) => b.kind)).toEqual(["ccd", "claude-json"])
  })

  it("1つ上の .claude.json の退避(復元の直前に作られるもの)も一覧に出る。他のファイルの退避は拾わない", async () => {
    const project = await makeGlobalLikeProject()
    const parent = path.dirname(project.path)
    await fs.writeFile(path.join(parent, `.claude.json.ccd-backup.${BACKUP_TS}`), "{}")
    await fs.writeFile(path.join(parent, `other.json.ccd-backup.${BACKUP_TS}`), "{}")

    const backups = await listBackups(project)

    expect(backups).toHaveLength(1)
    expect(backups[0]).toMatchObject({ kind: "ccd", originalName: ".claude.json" })
  })

  it("ccdの退避を復元すると、元のファイルが退避時の内容に戻る", async () => {
    const project = await makeProject()
    const target = path.join(project.path, "CLAUDE.md")
    await fs.writeFile(path.join(project.path, `CLAUDE.md.ccd-backup.${BACKUP_TS}`), "削除前の内容")
    await fs.writeFile(target, "削除後の内容")

    await restoreBackup(project, `CLAUDE.md.ccd-backup.${BACKUP_TS}`, "ccd")

    expect(await fs.readFile(target, "utf-8")).toBe("削除前の内容")
  })

  it("復元の直前の内容も退避されるので、復元そのものも一覧から取り消せる", async () => {
    const project = await makeProject()
    const target = path.join(project.path, "settings.json")
    await fs.writeFile(path.join(project.path, `settings.json.ccd-backup.${BACKUP_TS}`), "古い")
    await fs.writeFile(target, "復元前の現在")

    await restoreBackup(project, `settings.json.ccd-backup.${BACKUP_TS}`, "ccd")

    const backups = await listBackups(project)
    const fresh = backups.find((b) => b.timestampMs !== BACKUP_TS)
    expect(fresh).toBeDefined()
    expect(await fs.readFile(path.join(project.path, fresh!.fileName), "utf-8")).toBe("復元前の現在")
  })

  it("元のファイルが消えていても(削除後)、退避から復元して作り直せる", async () => {
    const project = await makeProject()
    await fs.writeFile(path.join(project.path, `rules.json.ccd-backup.${BACKUP_TS}`), "戻したい")

    await restoreBackup(project, `rules.json.ccd-backup.${BACKUP_TS}`, "ccd")

    expect(await fs.readFile(path.join(project.path, "rules.json"), "utf-8")).toBe("戻したい")
  })

  it("一覧に無い名前・パス区切りを含む名前は拒否する", async () => {
    const project = await makeProject()
    await expect(restoreBackup(project, `CLAUDE.md.ccd-backup.${BACKUP_TS}`, "ccd")).rejects.toThrow("見つかりません")
    await expect(restoreBackup(project, "../evil.ccd-backup.1800000000000", "ccd")).rejects.toThrow("不正なファイル名です")
    const withBackslash = ["a", "b"].join(String.fromCharCode(92))
    await expect(restoreBackup(project, withBackslash, "ccd")).rejects.toThrow("不正なファイル名です")
  })

  it("kindを取り違えて指定しても、別の種類の退避は復元されない", async () => {
    const project = await makeGlobalLikeProject()
    await fs.mkdir(path.join(project.path, "backups"), { recursive: true })
    await fs.writeFile(path.join(project.path, "backups", ".claude.json.backup.1800000000000"), "{}")
    await fs.writeFile(path.join(project.path, `CLAUDE.md.ccd-backup.${BACKUP_TS}`), "x")

    await expect(restoreBackup(project, ".claude.json.backup.1800000000000", "ccd")).rejects.toThrow("見つかりません")
    await expect(restoreBackup(project, `CLAUDE.md.ccd-backup.${BACKUP_TS}`, "claude-json")).rejects.toThrow("見つかりません")
  })
})

describe("スキル本体(SKILL.md)の退避の一覧と復元", () => {
  const BACKUP_TS = 1_800_000_000_000
  const bundleOf = (skills: { dirName: string; body: string }[]): ExportBundle => ({
    version: 1,
    exportedAt: "now",
    sourceProjectName: "src",
    rules: [],
    skills: skills.map((s) => ({ dirName: s.dirName, name: s.dirName, description: "新", body: s.body })),
  })

  async function writeSkill(project: ProjectConfig, root: "skills" | "skills-disabled", dirName: string, body: string) {
    await fs.mkdir(path.join(project.path, root, dirName), { recursive: true })
    await fs.writeFile(path.join(project.path, root, dirName, "SKILL.md"), `---\nname: ${dirName}\ndescription: 旧\n---\n\n${body}\n`)
  }

  it("インポートで上書きしたスキルの退避が、location(skills/<名前>)・originalName(SKILL.md)つきで一覧に出る", async () => {
    const project = await makeProject()
    await writeSkill(project, "skills", "sample-skill", "旧本文")

    await applyImport(project, bundleOf([{ dirName: "sample-skill", body: "新本文" }]), {
      ruleCategories: [],
      skillDirNames: ["sample-skill"],
    })

    const backups = await listBackups(project)
    expect(backups).toHaveLength(1)
    expect(backups[0]).toMatchObject({ kind: "ccd", originalName: "SKILL.md", location: "skills/sample-skill" })
  })

  it("復元すると SKILL.md が上書き前の内容に戻り、復元前の内容も退避される", async () => {
    const project = await makeProject()
    await writeSkill(project, "skills", "sample-skill", "旧本文")
    await applyImport(project, bundleOf([{ dirName: "sample-skill", body: "新本文" }]), {
      ruleCategories: [],
      skillDirNames: ["sample-skill"],
    })
    const [backup] = await listBackups(project)
    const skillMd = path.join(project.path, "skills", "sample-skill", "SKILL.md")
    expect(await fs.readFile(skillMd, "utf-8")).toContain("新本文")

    await restoreBackup(project, backup.fileName, "ccd", backup.location)

    expect(await fs.readFile(skillMd, "utf-8")).toContain("旧本文")
    const after = await listBackups(project)
    expect(after).toHaveLength(2)
    const fresh = after.find((b) => b.fileName !== backup.fileName)
    expect(await fs.readFile(path.join(project.path, fresh!.location!, fresh!.fileName), "utf-8")).toContain("新本文")
  })

  it("無効化中(skills-disabled/)のスキルの退避も一覧に出て、復元できる", async () => {
    const project = await makeProject()
    await writeSkill(project, "skills-disabled", "off-skill", "現在")
    await fs.writeFile(path.join(project.path, "skills-disabled", "off-skill", `SKILL.md.ccd-backup.${BACKUP_TS}`), "退避時の内容")

    const [backup] = await listBackups(project)
    expect(backup).toMatchObject({ originalName: "SKILL.md", location: "skills-disabled/off-skill" })

    await restoreBackup(project, backup.fileName, "ccd", backup.location)
    expect(await fs.readFile(path.join(project.path, "skills-disabled", "off-skill", "SKILL.md"), "utf-8")).toBe("退避時の内容")
  })

  it("別のスキルの退避が同じ時刻でも、両方が一覧に出て、それぞれ自分のスキルへ復元される", async () => {
    const project = await makeProject()
    for (const name of ["skill-a", "skill-b"]) {
      await writeSkill(project, "skills", name, "現在")
      await fs.writeFile(path.join(project.path, "skills", name, `SKILL.md.ccd-backup.${BACKUP_TS}`), `${name}の退避`)
    }

    const backups = await listBackups(project)
    expect(backups.map((b) => b.location).sort()).toEqual(["skills/skill-a", "skills/skill-b"])
    expect(new Set(backups.map((b) => b.fileName)).size).toBe(1)

    await restoreBackup(project, `SKILL.md.ccd-backup.${BACKUP_TS}`, "ccd", "skills/skill-b")

    expect(await fs.readFile(path.join(project.path, "skills", "skill-b", "SKILL.md"), "utf-8")).toBe("skill-bの退避")
    expect(await fs.readFile(path.join(project.path, "skills", "skill-a", "SKILL.md"), "utf-8")).toContain("現在")
  })

  it("location を付けずにスキルの退避の名前だけを渡しても、復元されない", async () => {
    const project = await makeProject()
    await writeSkill(project, "skills", "sample-skill", "現在")
    await fs.writeFile(path.join(project.path, "skills", "sample-skill", `SKILL.md.ccd-backup.${BACKUP_TS}`), "退避")

    await expect(restoreBackup(project, `SKILL.md.ccd-backup.${BACKUP_TS}`, "ccd")).rejects.toThrow("見つかりません")
  })

  it("不正な location（.. ・絶対パス・階層が違う・存在しない組）は拒否され、何も書き換わらない", async () => {
    const project = await makeProject()
    await writeSkill(project, "skills", "sample-skill", "現在")
    await fs.writeFile(path.join(project.path, "skills", "sample-skill", `SKILL.md.ccd-backup.${BACKUP_TS}`), "退避")
    const name = `SKILL.md.ccd-backup.${BACKUP_TS}`

    for (const bad of ["skills/..", "skills/../x", "../skills/sample-skill", "/skills/sample-skill", "skills/a/b", "other/sample-skill", "skills\\sample-skill", ""]) {
      await expect(restoreBackup(project, name, "ccd", bad)).rejects.toThrow("不正な場所です")
    }
    // 形は正しいが、そのスキルには無い組
    await expect(restoreBackup(project, name, "ccd", "skills/no-such-skill")).rejects.toThrow("見つかりません")
    await expect(restoreBackup(project, name, "ccd", "skills-disabled/sample-skill")).rejects.toThrow("見つかりません")
    // claude-json には location を付けられない
    await expect(restoreBackup(project, name, "claude-json", "skills/sample-skill")).rejects.toThrow("不正な場所です")

    expect(await fs.readFile(path.join(project.path, "skills", "sample-skill", "SKILL.md"), "utf-8")).toContain("現在")
  })

  it("スキルのフォルダの退避は SKILL.md のものだけを拾う（ほかのファイルの退避・フォルダは拾わない）", async () => {
    const project = await makeProject()
    await writeSkill(project, "skills", "sample-skill", "現在")
    await fs.writeFile(path.join(project.path, "skills", "sample-skill", `notes.md.ccd-backup.${BACKUP_TS}`), "x")
    await fs.mkdir(path.join(project.path, "skills", "sample-skill", `SKILL.md.ccd-backup.${BACKUP_TS + 1}`))

    expect(await listBackups(project)).toEqual([])
  })
})

describe("スキルの退避の name（改名前の内容かどうか）", () => {
  it("改名前の退避は、SKILL.md に書かれている古い名前が skillName に入り、フォルダ名と違う。編集だけの退避は、フォルダ名と同じ", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "old-name", description: "d", body: "本文" })
    await updateSkill(project, "old-name", { body: "編集後" })
    await renameSkill(project, "old-name", "new-name")

    const backups = await listBackups(project)

    expect(backups).toHaveLength(2)
    // 新しい順: 改名の直前（まだ old-name だった内容）、編集の直前（old-name だった内容）。どちらも改名前なので古い名前
    expect(backups.map((b) => [b.location, b.skillName])).toEqual([
      ["skills/new-name", "old-name"],
      ["skills/new-name", "old-name"],
    ])
  })

  it("改名したあとに編集した退避は、新しい名前が skillName に入る。name が書かれていない・読めない退避は skillName なし", async () => {
    const project = await makeProject()
    await createSkill(project, { dirName: "old-name", description: "d", body: "本文" })
    await renameSkill(project, "old-name", "new-name")
    await updateSkill(project, "new-name", { body: "改名後の編集" })
    await fs.writeFile(path.join(project.path, "skills", "new-name", "SKILL.md.ccd-backup.1800000000000"), "frontmatter なし")

    const backups = await listBackups(project)
    const byTime = new Map(backups.map((b) => [b.timestampMs, b.skillName]))

    expect(byTime.get(1800000000000)).toBeUndefined()
    expect(backups.filter((b) => b.skillName === "new-name")).toHaveLength(1)
    expect(backups.filter((b) => b.skillName === "old-name")).toHaveLength(1)
  })

  it("スキル以外の退避（CLAUDE.md など）には skillName が付かない", async () => {
    const project = await makeProject()
    await fs.writeFile(path.join(project.path, "CLAUDE.md.ccd-backup.1800000000000"), "---\nname: x\n---\n本文")

    const [backup] = await listBackups(project)

    expect(backup.skillName).toBeUndefined()
    expect(backup.location).toBeUndefined()
  })
})
