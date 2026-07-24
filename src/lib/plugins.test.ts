import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { listBlockedPlugins } from "./plugins"
import { ProjectConfig } from "./types"

const cleanupDirs: string[] = []

async function makeProject(): Promise<ProjectConfig> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-plugins-test-"))
  cleanupDirs.push(tmpDir)
  return { id: "test", name: "test", path: tmpDir }
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("listBlockedPlugins", () => {
  it("blocklist.jsonが無ければ空配列を返す", async () => {
    const project = await makeProject()
    expect(await listBlockedPlugins(project)).toEqual([])
  })

  it("blocklist.jsonのpluginsをそのまま返す", async () => {
    const project = await makeProject()
    await fs.mkdir(path.join(project.path, "plugins"), { recursive: true })
    await fs.writeFile(
      path.join(project.path, "plugins", "blocklist.json"),
      JSON.stringify({
        plugins: [
          { plugin: "foo@bar", added_at: "2026-01-01", reason: "security", text: "t" },
        ],
      })
    )

    const result = await listBlockedPlugins(project)
    expect(result).toHaveLength(1)
    expect(result[0].plugin).toBe("foo@bar")
  })
})
