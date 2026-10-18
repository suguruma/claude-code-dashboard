import { constants as fsConstants, promises as fs } from "fs"
import os from "os"
import path from "path"
import { selectExpired } from "./retention"

export class FileIOError extends Error {}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8")
    return JSON.parse(raw) as T
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === "ENOENT") return structuredClone(fallback)
    if (err instanceof SyntaxError) {
      throw new FileIOError(`${path.basename(filePath)} の JSON 構文が不正です: ${err.message}`)
    }
    throw new FileIOError(`${path.basename(filePath)} の読み込みに失敗しました: ${String(err)}`)
  }
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8")
  await fs.rename(tmpPath, filePath)
}

export async function readTextFile(filePath: string, fallback = ""): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8")
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === "ENOENT") return fallback
    throw new FileIOError(`${path.basename(filePath)} の読み込みに失敗しました: ${String(err)}`)
  }
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmpPath, content, "utf-8")
  await fs.rename(tmpPath, filePath)
}

/**
 * 相対パスの基準ディレクトリ。通常はprocess.cwd()でよいが、Electron配布版では
 * Next.jsのstandalone server.jsが起動時に無条件でprocess.chdir(__dirname)を実行し
 * cwdを自身のリソースディレクトリへ書き換えてしまうため、spawn時のcwd指定だけでは
 * config/projects.jsonやsample-data等の実データ配置場所を制御できない。
 * そのためElectron側は環境変数CCD_DATA_DIRで明示的にユーザーデータ領域を指定し、
 * こちらが設定されていればprocess.cwd()より優先する（未設定時は従来どおりcwd基準）。
 */
export function getAppDataRoot(): string {
  return process.env.CCD_DATA_DIR || process.cwd()
}

export function resolveProjectRoot(projectRoot: string): string {
  return path.isAbsolute(projectRoot) ? projectRoot : path.join(getAppDataRoot(), projectRoot)
}

export function resolveProjectPath(projectRoot: string, fileName: string): string {
  return path.join(resolveProjectRoot(projectRoot), fileName)
}

export const BACKUP_INFIX = ".ccd-backup."

/**
 * 上書き・削除の前に同名バックアップ(`<file>.ccd-backup.<epoch ms>`)を作成する。元ファイルが無い場合は何もしない。
 * 同じミリ秒に続けて呼ばれても別の世代になるよう、既にあれば時刻を進めて作る。
 * 作成後、同じファイルの古い退避を保持方針(retention.ts)に従って削除する。削除の失敗は無視する(退避の作成は成功している)。
 * 退避の作成に失敗したときは例外を投げるので、呼び出し側は書き込み・削除を行わないこと。
 */
export async function backupFile(filePath: string): Promise<string | null> {
  try {
    await fs.access(filePath)
  } catch {
    return null
  }
  let timestamp = Date.now()
  for (;;) {
    const backupPath = `${filePath}${BACKUP_INFIX}${timestamp}`
    try {
      await fs.copyFile(filePath, backupPath, fsConstants.COPYFILE_EXCL)
      await pruneBackups(filePath).catch(() => undefined)
      return backupPath
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
      timestamp += 1
    }
  }
}

/** `<file>.ccd-backup.<epoch ms>` の退避を、保持方針に従って古いものから削除する */
export async function pruneBackups(filePath: string, nowMs = Date.now()): Promise<string[]> {
  const dir = path.dirname(filePath)
  const prefix = `${path.basename(filePath)}${BACKUP_INFIX}`
  const candidates: { name: string; timestampMs: number }[] = []
  for (const name of await fs.readdir(dir)) {
    if (!name.startsWith(prefix)) continue
    const suffix = name.slice(prefix.length)
    if (!/^\d{10,}$/.test(suffix)) continue
    candidates.push({ name, timestampMs: Number(suffix) })
  }
  const expired = selectExpired(candidates, nowMs)
  await Promise.all(expired.map((name) => fs.rm(path.join(dir, name), { force: true })))
  return expired
}

/**
 * `<dir>.ccd-backup.<epoch ms>` というフォルダの退避を、保持方針(retention.ts)に従って古いものから削除する(フォルダ版)。
 * 消すのは、同じ親フォルダにある「<dir名><infix><数字>」だけ(infix の既定は `.ccd-backup.`)。本体(`<dir>`)と、名前の違うフォルダ・ファイルには触れない。
 */
export async function pruneDirBackups(dirPath: string, nowMs = Date.now(), infix = BACKUP_INFIX): Promise<string[]> {
  const parent = path.dirname(dirPath)
  const prefix = `${path.basename(dirPath)}${infix}`
  const candidates: { name: string; timestampMs: number }[] = []
  for (const dirent of await fs.readdir(parent, { withFileTypes: true })) {
    if (!dirent.isDirectory() || !dirent.name.startsWith(prefix)) continue
    const suffix = dirent.name.slice(prefix.length)
    if (!/^\d{10,}$/.test(suffix)) continue
    candidates.push({ name: dirent.name, timestampMs: Number(suffix) })
  }
  const expired = selectExpired(candidates, nowMs)
  await Promise.all(expired.map((name) => fs.rm(path.join(parent, name), { recursive: true, force: true })))
  return expired
}

/** 指定されたプロジェクトルートが、実際のClaude Codeグローバル設定（~/.claude）と一致するかを判定する */
export function isGlobalClaudeConfig(projectRoot: string): boolean {
  const base = path.isAbsolute(projectRoot)
    ? projectRoot
    : path.join(getAppDataRoot(), projectRoot)
  const globalRoot = path.join(os.homedir(), ".claude")
  const normalize = (p: string) => path.normalize(p).replace(/[\\/]+$/, "").toLowerCase()
  return normalize(base) === normalize(globalRoot)
}
