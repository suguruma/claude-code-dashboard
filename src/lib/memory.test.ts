import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { getMemoryEntries, listMemoryProjects } from "./memory"
import { ProjectConfig } from "./types"

const cleanupDirs: string[] = []

async function makeProject(): Promise<ProjectConfig> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-memory-test-"))
  cleanupDirs.push(tmpDir)
  return { id: "test", name: "test", path: tmpDir }
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("listMemoryProjects", () => {
  it("projectsディレクトリが無ければ空配列を返す", async () => {
    const project = await makeProject()
    expect(await listMemoryProjects(project)).toEqual([])
  })

  it("memoryファイルを持つプロジェクトのみを一覧化する", async () => {
    const project = await makeProject()
    await fs.mkdir(path.join(project.path, "projects", "proj-a", "memory"), { recursive: true })
    await fs.writeFile(
      path.join(project.path, "projects", "proj-a", "memory", "MEMORY.md"),
      "# Memory Index"
    )
    await fs.writeFile(
      path.join(project.path, "projects", "proj-a", "memory", "feedback_x.md"),
      "---\nname: x\ndescription: y\n---\nbody"
    )
    await fs.mkdir(path.join(project.path, "projects", "proj-b"), { recursive: true })

    const result = await listMemoryProjects(project)
    expect(result).toEqual([{ dirName: "proj-a", entryCount: 1 }])
  })
})

describe("getMemoryEntries", () => {
  it("MEMORY.mdを除外し、frontmatterをパースしてtypeを取り出す", async () => {
    const project = await makeProject()
    const memoryDir = path.join(project.path, "projects", "proj-a", "memory")
    await fs.mkdir(memoryDir, { recursive: true })
    await fs.writeFile(path.join(memoryDir, "MEMORY.md"), "# index")
    await fs.writeFile(
      path.join(memoryDir, "feedback_voice.md"),
      [
        "---",
        "name: feedback-voice-input",
        "description: 音声入力を前提に補正する",
        "metadata:",
        "  node_type: memory",
        "  type: feedback",
        "---",
        "",
        "本文の内容",
      ].join("\n")
    )

    const entries = await getMemoryEntries(project, "proj-a")
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      fileName: "feedback_voice.md",
      name: "feedback-voice-input",
      type: "feedback",
    })
    expect(entries[0].body).toContain("本文の内容")
  })

  it("frontmatterが壊れたファイルはスキップし他のエントリに影響しない", async () => {
    const project = await makeProject()
    const memoryDir = path.join(project.path, "projects", "proj-a", "memory")
    await fs.mkdir(memoryDir, { recursive: true })
    await fs.writeFile(path.join(memoryDir, "broken.md"), "---\nname: [invalid: yaml\n---\nbody")
    await fs.writeFile(
      path.join(memoryDir, "ok.md"),
      "---\nname: ok\ndescription: d\nmetadata:\n  type: user\n---\nbody"
    )

    const entries = await getMemoryEntries(project, "proj-a")
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe("ok")
  })

  it("存在しないプロジェクトディレクトリは空配列を返す", async () => {
    const project = await makeProject()
    expect(await getMemoryEntries(project, "does-not-exist")).toEqual([])
  })
})
