import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { getSettings } from "./settings"
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
