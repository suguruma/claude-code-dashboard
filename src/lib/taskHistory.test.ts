import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { listTaskSessions } from "./taskHistory"
import { ProjectConfig } from "./types"

const cleanupDirs: string[] = []

async function makeProject(): Promise<ProjectConfig> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-taskhistory-test-"))
  cleanupDirs.push(tmpDir)
  return { id: "test", name: "test", path: tmpDir }
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("listTaskSessions", () => {
  it("tasksディレクトリが無ければ空配列を返す", async () => {
    const project = await makeProject()
    expect(await listTaskSessions(project)).toEqual([])
  })

  it("タスクをID順にソートし、.lockなどjson以外は無視する", async () => {
    const project = await makeProject()
    const sessionDir = path.join(project.path, "tasks", "session-a")
    await fs.mkdir(sessionDir, { recursive: true })
    await fs.writeFile(path.join(sessionDir, ".lock"), "")
    await fs.writeFile(
      path.join(sessionDir, "2.json"),
      JSON.stringify({ id: "2", subject: "second", status: "pending", blocks: [], blockedBy: ["1"] })
    )
    await fs.writeFile(
      path.join(sessionDir, "1.json"),
      JSON.stringify({ id: "1", subject: "first", status: "completed", blocks: ["2"], blockedBy: [] })
    )

    const sessions = await listTaskSessions(project)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].sessionId).toBe("session-a")
    expect(sessions[0].tasks.map((t) => t.subject)).toEqual(["first", "second"])
  })

  it("壊れたJSONはスキップし他のタスクに影響しない", async () => {
    const project = await makeProject()
    const sessionDir = path.join(project.path, "tasks", "session-a")
    await fs.mkdir(sessionDir, { recursive: true })
    await fs.writeFile(path.join(sessionDir, "1.json"), "{ invalid json")
    await fs.writeFile(
      path.join(sessionDir, "2.json"),
      JSON.stringify({ id: "2", subject: "ok", status: "pending", blocks: [], blockedBy: [] })
    )

    const sessions = await listTaskSessions(project)
    expect(sessions[0].tasks).toHaveLength(1)
    expect(sessions[0].tasks[0].subject).toBe("ok")
  })

  it("タスクが1件も無いセッションディレクトリは一覧から除外する", async () => {
    const project = await makeProject()
    await fs.mkdir(path.join(project.path, "tasks", "empty-session"), { recursive: true })
    expect(await listTaskSessions(project)).toEqual([])
  })

  it("更新日時が新しいセッションを先頭にする", async () => {
    const project = await makeProject()
    const oldDir = path.join(project.path, "tasks", "old-session")
    const newDir = path.join(project.path, "tasks", "new-session")
    await fs.mkdir(oldDir, { recursive: true })
    await fs.mkdir(newDir, { recursive: true })
    await fs.writeFile(
      path.join(oldDir, "1.json"),
      JSON.stringify({ id: "1", subject: "old", status: "completed", blocks: [], blockedBy: [] })
    )
    await fs.writeFile(
      path.join(newDir, "1.json"),
      JSON.stringify({ id: "1", subject: "new", status: "pending", blocks: [], blockedBy: [] })
    )

    const oldTime = new Date("2026-01-01")
    const newTime = new Date("2026-06-01")
    await fs.utimes(oldDir, oldTime, oldTime)
    await fs.utimes(newDir, newTime, newTime)

    const sessions = await listTaskSessions(project)
    expect(sessions.map((s) => s.sessionId)).toEqual(["new-session", "old-session"])
  })
})
