import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { listBackups, restoreBackup } from "./backups"
import { ProjectConfig } from "./types"

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
