/**
 * スマホ(LAN の入り口の経由)へ返す API の応答から、PC のフォルダのパスを隠す(⑪ の Q5)。
 * 画面で隠すだけでは、入り口の経由の API の JSON にパスが残るため、サーバーの側で隠す。
 * - 作業フォルダ(`cwd`)・データの場所(`path`)は、最後のフォルダ名だけにする。ホームのフォルダそのもの
 *   (`C:\Users\<名前>`・`/Users/<名前>`・`/home/<名前>`)は、名前を出さずに `~` にする
 * - 作業フォルダの最後の名前(`folderName`)は、パスの形でないので文字列としては隠れない。同じオブジェクトの `cwd` から
 *   作り直す(ホームのフォルダそのものなら `~`。`cwd` が無ければ null)。ユーザー名が名前として残らないように
 * - `~/.claude/projects/` のフォルダ名(`projectDirName`。パスを `-` でつないだ名前)は null にする
 * - そのほかの文字列とオブジェクトのキーの中の、絶対パス(`C:\…`・`\\server\…`・`/Users/…`・`/Volumes/…`・`~\…`・`file:///…`・
 *   `C%3A%5C…` のような URL エンコード・`C--Users-…` のようなパスを `-` でつないだ名前)も隠す
 */

const PATH_KEYS = new Set(["cwd", "path"])
const DROP_KEYS = new Set(["projectDirName"])
/** パスから作った名前の項目と、その元のパスの項目。元のパスから作り直す */
const DERIVED_NAME_KEYS = new Map([["folderName", "cwd"]])

/** ホームのフォルダの直下(ユーザー名)。この名前は出さない */
const HOME_DIR = /^(?:[A-Za-z]:[\\/]+(?:Users|Documents and Settings)|[\\/]+(?:Users|home))[\\/]+[^\\/]+[\\/]*$/i

const TOKEN = String.raw`[^\s"'<>|]*`
/** 文字列の中の、パスらしいもの(長いもの・特殊なものから順に試す) */
const PATTERNS: RegExp[] = [
  // file:///C:/… や file://server/…
  new RegExp(String.raw`file:\/\/\/?` + TOKEN, "gi"),
  // URL エンコードした Windows のパス(C%3A%5C… / C%3A%2F…)
  new RegExp(String.raw`(?<![A-Za-z0-9])[A-Za-z]%3A(?:%5C|%2F)` + TOKEN, "gi"),
  // Windows のドライブ(前に英字が無いもの)・UNC
  new RegExp(String.raw`(?<![A-Za-z0-9])[A-Za-z]:[\\/]` + TOKEN + String.raw`|\\\\` + TOKEN, "g"),
  // ホームの下(~/… ~\…)・POSIX のホームや作業場所・macOS の外付けの場所(/Volumes/<名前>/…)
  new RegExp(String.raw`~[\\/]` + TOKEN + String.raw`|(?<![A-Za-z0-9])\/(?:Users|home|mnt|root|var|tmp|opt|Volumes)\/` + TOKEN, "g"),
]
/** パスを `-` でつないだ名前(`C--Users-someone-work` のような、~/.claude/projects/ のフォルダ名) */
const DASHED_PATH = /(?<![A-Za-z0-9])[A-Za-z]--[A-Za-z0-9._-]+/g
/** ほかで拾えなかった、`\` を含む語(空白を含むパスの残りなど) */
const BACKSLASH_TOKEN = new RegExp(TOKEN + String.raw`\\` + TOKEN, "g")

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** パスを、最後の名前にする。ホームのフォルダそのものは `~`、ドライブだけは空 */
export function lastSegment(p: string): string {
  const plain = decodeSafe(p.replace(/^file:\/\/\/?/i, ""))
  if (HOME_DIR.test(plain)) return "~"
  const parts = plain.split(/[\\/]+/).filter(Boolean)
  const last = parts[parts.length - 1] ?? ""
  return /^[A-Za-z]:$/.test(last) || last === "~" ? "" : last
}

function redactString(s: string): string {
  let out = s
  for (const re of PATTERNS) out = out.replace(re, (m) => lastSegment(m) || "…")
  out = out.replace(DASHED_PATH, "…")
  out = out.replace(BACKSLASH_TOKEN, (m) => lastSegment(m) || "…")
  return out
}

export function redactForLan<T>(value: T): T {
  return walk(value, null) as T
}

function walk(value: unknown, key: string | null): unknown {
  if (typeof value === "string") {
    if (key && PATH_KEYS.has(key)) return lastSegment(value) || null
    return redactString(value)
  }
  if (Array.isArray(value)) return value.map((v) => walk(v, null))
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    const source = value as Record<string, unknown>
    for (const [k, v] of Object.entries(value)) {
      const from = DERIVED_NAME_KEYS.get(k)
      if (from !== undefined) {
        const p = source[from]
        out[redactString(k)] = typeof p === "string" ? lastSegment(p) || null : null
        continue
      }
      out[redactString(k)] = DROP_KEYS.has(k) ? null : walk(v, k)
    }
    return out
  }
  return value
}
