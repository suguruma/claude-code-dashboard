import { promises as fs } from "fs"
import path from "path"
import { BACKUP_INFIX, backupFile, resolveProjectPath, resolveProjectRoot } from "./fileIO"
import { BackupEntry, BackupKind, ProjectConfig } from "./types"

const TIMESTAMP_RE = /\.(\d{10,})$/
const CCD_BACKUP_RE = new RegExp(`^(.+)${BACKUP_INFIX.replace(/\./g, "\\.")}(\\d{10,})$`)
const CLAUDE_JSON_NAME = ".claude.json"

/**
 * `.claude.json`（Claude Code本体のセッション/信頼設定ファイル）本体のパス。
 * `~/.claude`（設定ディレクトリ）と兄弟の`~/.claude.json`に実在するため、
 * バックアップ格納先（`<project.path>/backups/`）とは異なりproject.pathの1つ上を指す。
 */
function claudeJsonPath(project: ProjectConfig): string {
  return path.join(path.dirname(resolveProjectRoot(project.path)), CLAUDE_JSON_NAME)
}

interface CcdBackup extends BackupEntry {
  /** 退避ファイルがあるディレクトリ。復元先も同じディレクトリの originalName */
  dir: string
}

/**
 * このダッシュボードが書き換え・削除の直前に作った退避(`<ファイル名>.ccd-backup.<epoch>`)を集める。
 * 対象は、プロジェクトのルート直下(CLAUDE.md・settings.json・execution_log.json など)と、
 * 1つ上にある `.claude.json` の退避(「バックアップから復元」の直前に作られる)。
 */
async function listCcdBackups(project: ProjectConfig): Promise<CcdBackup[]> {
  const root = resolveProjectRoot(project.path)
  const sources: { dir: string; only?: string }[] = [{ dir: root }, { dir: path.dirname(root), only: CLAUDE_JSON_NAME }]

  const found: CcdBackup[] = []
  const seen = new Set<string>()
  for (const { dir, only } of sources) {
    let names: string[]
    try {
      names = await fs.readdir(dir)
    } catch {
      continue
    }
    for (const name of names) {
      const match = CCD_BACKUP_RE.exec(name)
      if (!match || (only && match[1] !== only) || seen.has(name)) continue
      let stat
      try {
        stat = await fs.stat(path.join(dir, name))
      } catch {
        continue
      }
      if (!stat.isFile()) continue
      seen.add(name)
      found.push({
        fileName: name,
        timestampMs: Number(match[2]),
        sizeBytes: stat.size,
        kind: "ccd",
        originalName: match[1],
        dir,
      })
    }
  }
  return found
}

export async function listBackups(project: ProjectConfig): Promise<BackupEntry[]> {
  const backupsDir = resolveProjectPath(project.path, "backups")
  let fileNames: string[]
  try {
    fileNames = await fs.readdir(backupsDir)
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code !== "ENOENT") throw err
    fileNames = []
  }

  const entries: BackupEntry[] = []
  for (const fileName of fileNames) {
    const match = TIMESTAMP_RE.exec(fileName)
    const stat = await fs.stat(path.join(backupsDir, fileName))
    entries.push({
      fileName,
      timestampMs: match ? Number(match[1]) : null,
      sizeBytes: stat.size,
      kind: "claude-json",
    })
  }
  for (const b of await listCcdBackups(project)) {
    entries.push({
      fileName: b.fileName,
      timestampMs: b.timestampMs,
      sizeBytes: b.sizeBytes,
      kind: b.kind,
      originalName: b.originalName,
    })
  }

  entries.sort((a, b) => (b.timestampMs ?? 0) - (a.timestampMs ?? 0))
  return entries
}

/**
 * バックアップ一覧の中から指定したファイルを復元する（不可逆・上書き操作）。復元の直前に、その時点のファイルも
 * `.ccd-backup.<epoch>`として退避するので、復元自体も一覧から取り消せる。
 * - kind が "claude-json"（既定）: `backups/` の退避を `.claude.json` 本体へ復元する
 * - kind が "ccd": ダッシュボードが作った `<ファイル名>.ccd-backup.<epoch>` を、元のファイル名へ復元する
 */
export async function restoreBackup(
  project: ProjectConfig,
  fileName: string,
  kind: BackupKind = "claude-json"
): Promise<void> {
  if (fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
    throw new Error("不正なファイル名です")
  }

  if (kind === "ccd") {
    const backup = (await listCcdBackups(project)).find((b) => b.fileName === fileName)
    if (!backup || !backup.originalName) throw new Error("指定されたバックアップが見つかりません")
    await replaceFileKeepingBackup(path.join(backup.dir, backup.fileName), path.join(backup.dir, backup.originalName))
    return
  }

  const backups = await listBackups(project)
  if (!backups.some((b) => b.kind === "claude-json" && b.fileName === fileName)) {
    throw new Error("指定されたバックアップが見つかりません")
  }
  const backupsDir = resolveProjectPath(project.path, "backups")
  await replaceFileKeepingBackup(path.join(backupsDir, fileName), claudeJsonPath(project))
}

/**
 * sourcePath の内容で targetPath を置き換える。置き換える前に現在の targetPath を退避する。
 * 先に復元元を一時ファイルへ複製してから退避を作るのは、退避を作った直後の古い世代の整理で、復元元が消えないようにするため。
 */
async function replaceFileKeepingBackup(sourcePath: string, targetPath: string): Promise<void> {
  const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`
  await fs.copyFile(sourcePath, tmpPath)
  try {
    await backupFile(targetPath)
    await fs.rename(tmpPath, targetPath)
  } catch (err) {
    await fs.rm(tmpPath, { force: true })
    throw err
  }
}
