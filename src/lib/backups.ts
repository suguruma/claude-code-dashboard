import { promises as fs } from "fs"
import path from "path"
import { backupFile, resolveProjectPath, resolveProjectRoot } from "./fileIO"
import { BackupEntry, ProjectConfig } from "./types"

const TIMESTAMP_RE = /\.(\d{10,})$/

/**
 * `.claude.json`（Claude Code本体のセッション/信頼設定ファイル）本体のパス。
 * `~/.claude`（設定ディレクトリ）と兄弟の`~/.claude.json`に実在するため、
 * バックアップ格納先（`<project.path>/backups/`）とは異なりproject.pathの1つ上を指す。
 */
function claudeJsonPath(project: ProjectConfig): string {
  return path.join(path.dirname(resolveProjectRoot(project.path)), ".claude.json")
}

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

/**
 * バックアップ一覧の中から指定したファイルを`.claude.json`本体へ復元する（不可逆・上書き操作）。
 * 復元前に、その時点の`.claude.json`自体も`.ccd-backup.<epoch>`として退避する（誤操作からの回復用）。
 */
export async function restoreBackup(project: ProjectConfig, fileName: string): Promise<void> {
  if (fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
    throw new Error("不正なファイル名です")
  }
  const backups = await listBackups(project)
  if (!backups.some((b) => b.fileName === fileName)) {
    throw new Error("指定されたバックアップが見つかりません")
  }

  const backupsDir = resolveProjectPath(project.path, "backups")
  const sourcePath = path.join(backupsDir, fileName)
  const targetPath = claudeJsonPath(project)

  await backupFile(targetPath)
  await fs.copyFile(sourcePath, targetPath)
}
