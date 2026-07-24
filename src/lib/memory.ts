import { promises as fs, type Dirent } from "fs"
import path from "path"
import { resolveProjectPath } from "./fileIO"
import { parseFrontmatter } from "./frontmatter"
import { MemoryEntry, MemoryProject, ProjectConfig } from "./types"

function projectsRootDir(project: ProjectConfig): string {
  return resolveProjectPath(project.path, "projects")
}

async function readMemoryDirFiles(memoryDir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(memoryDir)
    return files.filter((f) => f.endsWith(".md") && f !== "MEMORY.md")
  } catch {
    return []
  }
}

export async function listMemoryProjects(project: ProjectConfig): Promise<MemoryProject[]> {
  const root = projectsRootDir(project)
  let dirents: Dirent[]
  try {
    dirents = await fs.readdir(root, { withFileTypes: true })
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === "ENOENT") return []
    throw err
  }

  const results: MemoryProject[] = []
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue
    const memoryDir = path.join(root, dirent.name, "memory")
    const mdFiles = await readMemoryDirFiles(memoryDir)
    if (mdFiles.length > 0) {
      results.push({ dirName: dirent.name, entryCount: mdFiles.length })
    }
  }
  return results.sort((a, b) => a.dirName.localeCompare(b.dirName))
}

export async function getMemoryEntries(
  project: ProjectConfig,
  dirName: string
): Promise<MemoryEntry[]> {
  const memoryDir = path.join(projectsRootDir(project), dirName, "memory")
  const mdFiles = await readMemoryDirFiles(memoryDir)

  const entries: MemoryEntry[] = []
  for (const fileName of mdFiles) {
    try {
      const content = await fs.readFile(path.join(memoryDir, fileName), "utf-8")
      const { data, body } = parseFrontmatter(content)
      const metadata = (data.metadata as Record<string, unknown>) ?? {}
      entries.push({
        fileName,
        name: typeof data.name === "string" ? data.name : fileName,
        description: typeof data.description === "string" ? data.description : "",
        type: typeof metadata.type === "string" ? metadata.type : "unknown",
        body: body.trim(),
      })
    } catch {
      // 個別ファイルの読み込み・パースエラーはスキップし、他のエントリ表示に影響させない
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name))
}
