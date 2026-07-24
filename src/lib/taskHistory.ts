import { promises as fs, type Dirent } from "fs"
import path from "path"
import { resolveProjectPath } from "./fileIO"
import { ProjectConfig, TaskRecord, TaskSession } from "./types"

function tasksRootDir(project: ProjectConfig): string {
  return resolveProjectPath(project.path, "tasks")
}

async function readSessionTasks(sessionDir: string): Promise<TaskRecord[]> {
  const files = await fs.readdir(sessionDir)
  const jsonFiles = files.filter((f) => f.endsWith(".json"))

  const tasks: TaskRecord[] = []
  for (const fileName of jsonFiles) {
    try {
      const content = await fs.readFile(path.join(sessionDir, fileName), "utf-8")
      const data = JSON.parse(content) as Record<string, unknown>
      tasks.push({
        id: typeof data.id === "string" ? data.id : fileName.replace(/\.json$/, ""),
        subject: typeof data.subject === "string" ? data.subject : "",
        description: typeof data.description === "string" ? data.description : "",
        activeForm: typeof data.activeForm === "string" ? data.activeForm : undefined,
        status: typeof data.status === "string" ? data.status : "pending",
        blocks: Array.isArray(data.blocks) ? (data.blocks as string[]) : [],
        blockedBy: Array.isArray(data.blockedBy) ? (data.blockedBy as string[]) : [],
      })
    } catch {
      // 壊れたタスクファイルはスキップし、他のタスク表示に影響させない
    }
  }

  tasks.sort((a, b) => Number(a.id) - Number(b.id))
  return tasks
}

export async function listTaskSessions(project: ProjectConfig): Promise<TaskSession[]> {
  const root = tasksRootDir(project)
  let dirents: Dirent[]
  try {
    dirents = await fs.readdir(root, { withFileTypes: true })
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === "ENOENT") return []
    throw err
  }

  const sessionsWithMtime: { session: TaskSession; mtimeMs: number }[] = []
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue
    const sessionDir = path.join(root, dirent.name)
    const tasks = await readSessionTasks(sessionDir)
    if (tasks.length === 0) continue
    const stat = await fs.stat(sessionDir)
    sessionsWithMtime.push({ session: { sessionId: dirent.name, tasks }, mtimeMs: stat.mtimeMs })
  }

  sessionsWithMtime.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return sessionsWithMtime.map((s) => s.session)
}
