import { promises as fs } from "fs"
import os from "os"
import path from "path"

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

export function resolveProjectPath(projectRoot: string, fileName: string): string {
  const base = path.isAbsolute(projectRoot)
    ? projectRoot
    : path.join(getAppDataRoot(), projectRoot)
  return path.join(base, fileName)
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
