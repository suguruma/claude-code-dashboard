import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { getSettings, updateSettings } from "./settings"
import { FileIOError } from "./fileIO"
import { ProjectConfig } from "./types"

const cleanupDirs: string[] = []

async function makeProject(): Promise<ProjectConfig> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-settings-test-"))
  cleanupDirs.push(tmpDir)
  return { id: "test", name: "test", path: tmpDir }
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("getSettings", () => {
  it("settings.jsonが無ければ空のrawを返す", async () => {
    const project = await makeProject()
    expect(await getSettings(project)).toEqual({ raw: {} })
  })

  it("settings.jsonの内容をそのままrawとして返す", async () => {
    const project = await makeProject()
    await fs.writeFile(
      path.join(project.path, "settings.json"),
      JSON.stringify({
        env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "60" },
        permissions: { defaultMode: "acceptEdits" },
        autoUpdatesChannel: "latest",
      })
    )

    const { raw } = await getSettings(project)
    expect(raw.autoUpdatesChannel).toBe("latest")
    expect(raw.permissions).toEqual({ defaultMode: "acceptEdits" })
  })

  it("JSON構文が壊れている場合はFileIOErrorを投げる", async () => {
    const project = await makeProject()
    await fs.writeFile(path.join(project.path, "settings.json"), "{ invalid")
    await expect(getSettings(project)).rejects.toThrow(FileIOError)
  })
})

describe("updateSettings", () => {
  it("settings.jsonを新しい内容で上書きする", async () => {
    const project = await makeProject()
    await updateSettings(project, { autoUpdatesChannel: "stable" })

    const { raw } = await getSettings(project)
    expect(raw).toEqual({ autoUpdatesChannel: "stable" })
  })

  it("上書き前の内容を.ccd-backup.<epoch>として退避する", async () => {
    const project = await makeProject()
    const settingsPath = path.join(project.path, "settings.json")
    await fs.writeFile(settingsPath, JSON.stringify({ autoUpdatesChannel: "latest" }))

    await updateSettings(project, { autoUpdatesChannel: "stable" })

    const files = await fs.readdir(project.path)
    const backupFile = files.find((f) => f.includes(".ccd-backup."))
    expect(backupFile).toBeDefined()
    const backupContent = JSON.parse(await fs.readFile(path.join(project.path, backupFile!), "utf-8"))
    expect(backupContent.autoUpdatesChannel).toBe("latest")
  })

  it("既存settings.jsonが無い場合はバックアップを作らずそのまま書き込む", async () => {
    const project = await makeProject()
    await updateSettings(project, { autoUpdatesChannel: "stable" })
    const files = await fs.readdir(project.path)
    expect(files.some((f) => f.includes(".ccd-backup."))).toBe(false)
  })

  it("オブジェクト以外を渡すとエラーになる", async () => {
    const project = await makeProject()
    await expect(updateSettings(project, [] as unknown as Record<string, unknown>)).rejects.toThrow(
      "JSONオブジェクト"
    )
  })
})
