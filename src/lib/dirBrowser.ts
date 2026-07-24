import { promises as fs } from "fs"
import os from "os"
import path from "path"

export interface DirEntry {
  name: string
  path: string
  type: "directory" | "file"
  /** CLAUDE.md / skills / execution_log.json 等、Dashboardが扱う対象として注目すべきエントリかどうか */
  isNotable: boolean
}

export interface BrowseResult {
  path: string | null
  parentPath: string | null
  entries: DirEntry[]
}

const NOTABLE_NAMES = new Set(["CLAUDE.md", "skills", "execution_log.json", "settings.json"])

async function listWindowsDrives(): Promise<DirEntry[]> {
  const drives: DirEntry[] = []
  for (const code of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const drivePath = `${code}:\\`
    try {
      await fs.access(drivePath)
      drives.push({ name: drivePath, path: drivePath, type: "directory", isNotable: false })
    } catch {
      // ドライブが存在しない・アクセス不可な場合はスキップ
    }
  }
  return drives
}

export function getShortcuts(): { label: string; path: string }[] {
  const home = os.homedir()
  return [
    { label: "ホーム", path: home },
    { label: "~/.claude", path: path.join(home, ".claude") },
  ]
}

export async function browseDirectory(targetPath: string | null): Promise<BrowseResult> {
  if (!targetPath) {
    if (process.platform === "win32") {
      return { path: null, parentPath: null, entries: await listWindowsDrives() }
    }
    targetPath = "/"
  }

  const resolved = path.resolve(targetPath)
  const dirents = await fs.readdir(resolved, { withFileTypes: true })

  const entries: DirEntry[] = []
  for (const dirent of dirents) {
    const entryPath = path.join(resolved, dirent.name)
    if (dirent.isDirectory()) {
      entries.push({
        name: dirent.name,
        path: entryPath,
        type: "directory",
        isNotable: NOTABLE_NAMES.has(dirent.name),
      })
    } else if (dirent.isFile()) {
      entries.push({
        name: dirent.name,
        path: entryPath,
        type: "file",
        isNotable: NOTABLE_NAMES.has(dirent.name),
      })
    }
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const parent = path.dirname(resolved)
  const parentPath = parent === resolved ? null : parent

  return { path: resolved, parentPath, entries }
}
