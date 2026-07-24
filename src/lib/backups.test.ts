import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { listBackups } from "./backups"
import { ProjectConfig } from "./types"

const cleanupDirs: string[] = []

async function makeProject(): Promise<ProjectConfig> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-backups-test-"))
  cleanupDirs.push(tmpDir)
  return { id: "test", name: "test", path: tmpDir }
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
