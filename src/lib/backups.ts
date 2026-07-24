import { promises as fs } from "fs"
import path from "path"
import { resolveProjectPath } from "./fileIO"
import { BackupEntry, ProjectConfig } from "./types"

const TIMESTAMP_RE = /\.(\d{10,})$/

export async function listBackups(project: ProjectConfig): Promise<BackupEntry[]> {
  const backupsDir = resolveProjectPath(project.path, "backups")
  let fileNames: string[]
  try {
    fileNames = await fs.readdir(backupsDir)
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === "ENOENT") return []
    throw err
  }

  const entries: BackupEntry[] = []
  for (const fileName of fileNames) {
    const match = TIMESTAMP_RE.exec(fileName)
    const stat = await fs.stat(path.join(backupsDir, fileName))
    entries.push({
      fileName,
      timestampMs: match ? Number(match[1]) : null,
      sizeBytes: stat.size,
    })
  }

  entries.sort((a, b) => (b.timestampMs ?? 0) - (a.timestampMs ?? 0))
  return entries
}
