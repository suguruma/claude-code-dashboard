import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { getPreviewBlockReason } from "./sensitivePaths"

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

/** プレビューとして読み込むファイル内容の上限バイト数。ディレクトリピッカーでの簡易確認用のため小さめに抑える */
const PREVIEW_MAX_BYTES = 8 * 1024

export interface FilePreviewResult {
  content: string
  /** ファイルサイズが上限を超え、先頭のみを表示している場合true */
  truncated: boolean
  /** null バイトを含むなどテキストとして扱えないと判断した場合true（contentは空文字になる） */
  binary: boolean
}

/** 認証情報などプレビューを拒否するパスに対して投げる。APIでは403にマップする */
export class PreviewBlockedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = "PreviewBlockedError"
  }
}

function assertPreviewAllowed(p: string): void {
  const reason = getPreviewBlockReason(p)
  if (reason) throw new PreviewBlockedError(reason)
}

/**
 * ディレクトリピッカーでのファイル中身プレビュー用に、先頭PREVIEW_MAX_BYTESバイトのみを読み込む。
 * 巨大ファイル・バイナリファイルを誤ってメモリに全読み込みしないためのガード。
 */
export async function readFilePreview(targetPath: string): Promise<FilePreviewResult> {
  const resolved = path.resolve(targetPath)
  assertPreviewAllowed(resolved)
  // シンボリックリンク・ジャンクション・8.3短縮名を解決した実体のパスでも判定する(例: notes.txt -> .env)
  const real = await fs.realpath(resolved)
  assertPreviewAllowed(real)

  const stat = await fs.stat(real)
  if (!stat.isFile()) {
    throw new Error("指定されたパスはファイルではありません")
  }

  const readSize = Math.min(stat.size, PREVIEW_MAX_BYTES)
  const buffer = Buffer.alloc(readSize)
  const handle = await fs.open(real, "r")
  try {
    await handle.read(buffer, 0, readSize, 0)
  } finally {
    await handle.close()
  }

  if (buffer.includes(0)) {
    return { content: "", truncated: false, binary: true }
  }

  return {
    content: buffer.toString("utf-8"),
    truncated: stat.size > PREVIEW_MAX_BYTES,
    binary: false,
  }
}
