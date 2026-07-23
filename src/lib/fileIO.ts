import { promises as fs } from "fs"
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

export function resolveProjectPath(projectRoot: string, fileName: string): string {
  const base = path.isAbsolute(projectRoot)
    ? projectRoot
    : path.join(process.cwd(), projectRoot)
  return path.join(base, fileName)
}
