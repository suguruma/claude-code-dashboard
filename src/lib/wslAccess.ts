import { execFile } from "child_process"
import path from "path"
import { isSafePosixPath, WSL_DISTRO_FORM } from "./desktopSessions"

/**
 * WSL の作業フォルダを Windows から読むための入り口(⑱)。読み取り専用・外部と通信しない。
 *
 * - 動いている配布版は `%SystemRoot%\System32\wsl.exe -l --running -q` で調べる(この一覧は配布版を起こさない)。
 *   引数は固定で、外から来た文字は渡さない。結果は覚えず、読む直前に問い直す(同時の呼び出しだけ1つにまとめる)
 * - パスは `\\wsl.localhost\<配布版>\<WSL の絶対パス>` に置き換える。配布版の名前と WSL のパスは Desktop が記録した値だけを使い、
 *   推測しない(⑨ Q7)。`path.resolve` は使わず、組み立てた後に根の下にあることをもう一度確かめる
 * - 動いていない配布版の下は読まない(UNC のパスを開くと配布版が起きるため)。
 *   限界：調べた直後に止まった配布版は、その読み取りで起きることがある
 */

export interface WslAccess {
  /** 動いている配布版の名前。調べられない(wsl.exe が無い・失敗・時間切れ・Windows でない)ときは空 */
  runningDistros(): Promise<Set<string>>
  /** WSL の絶対パスを Windows から読むパスにする。形に合わなければ null */
  toWindowsPath(distro: string, posixPath: string): string | null
}

export interface WslAccessOptions {
  platform?: NodeJS.Platform
  /** 配布版の根(テストで差し替える)。既定は `\\wsl.localhost\<配布版>\` */
  rootOf?: (distro: string) => string
  /** 動いている配布版の一覧を返す(テストで差し替える)。既定は wsl.exe を呼ぶ */
  listRunning?: () => Promise<string[]>
}

const LIST_TIMEOUT_MS = 1500
const MAX_OUTPUT_BYTES = 64 * 1024

export const wslUncRoot = (distro: string): string => `\\\\wsl.localhost\\${distro}\\`

/** wsl.exe の出力(既定は UTF-16LE。WSL_UTF8=1 のときは UTF-8)を配布版の名前の列にする。形に合わない行は捨てる */
export function parseRunningList(out: Buffer): string[] {
  const text = (out.includes(0) ? out.toString("utf16le") : out.toString("utf8")).replace(/^\uFEFF/, "").replace(/\0/g, "")
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => WSL_DISTRO_FORM.test(l) && !l.includes(".."))
}

/** wsl.exe を絶対パスで呼ぶ(名前だけだと今のフォルダから先に探されるため)。終了コード 0 以外・時間切れは「どれも動いていない」 */
export function listRunningViaWslExe(run: typeof execFile = execFile): Promise<string[]> {
  const systemRoot = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows"
  const exe = path.win32.join(systemRoot, "System32", "wsl.exe")
  return new Promise((resolve) => {
    try {
      run(
        exe,
        ["-l", "--running", "-q"],
        { encoding: "buffer", timeout: LIST_TIMEOUT_MS, windowsHide: true, maxBuffer: MAX_OUTPUT_BYTES },
        (err, stdout) => resolve(err ? [] : parseRunningList(stdout as unknown as Buffer))
      )
    } catch {
      resolve([])
    }
  })
}

export function createWslAccess(options: WslAccessOptions = {}): WslAccess {
  const platform = options.platform ?? process.platform
  const rootOf = options.rootOf ?? wslUncRoot
  const list = options.listRunning ?? (() => listRunningViaWslExe())
  let inflight: Promise<Set<string>> | null = null

  return {
    runningDistros() {
      if (platform !== "win32") return Promise.resolve(new Set())
      if (inflight) return inflight
      const current = list()
        .then((names) => new Set(names))
        .catch(() => new Set<string>())
        .finally(() => {
          if (inflight === current) inflight = null
        })
      inflight = current
      return current
    },
    toWindowsPath(distro, posixPath) {
      if (!WSL_DISTRO_FORM.test(distro) || distro.includes("..") || !isSafePosixPath(posixPath)) return null
      const segments = posixPath.slice(1).split("/")
      // Windows は区間の末尾の `.`・空白を落として開き、`<>"|?*` を含む区間は開けない(別のフォルダを読む誤りを防ぐ)
      if (segments.some((seg) => /[. ]$/.test(seg) || /[<>"|?*]/.test(seg))) return null
      const root = path.win32.normalize(rootOf(distro))
      const joined = path.win32.join(root, ...segments)
      const base = root.endsWith("\\") ? root : root + "\\"
      return joined.toLowerCase().startsWith(base.toLowerCase()) && joined.length > base.length ? joined : null
    },
  }
}

let shared: WslAccess | null = null
export function getWslAccess(): WslAccess {
  if (!shared) shared = createWslAccess()
  return shared
}
