import path from "path"

/**
 * ファイル中身のプレビューを拒否する、認証情報・秘密鍵・Claude Desktop 内部データのパス判定。
 * ディレクトリピッカーは任意のフォルダを辿れるため、HTTP経由で秘密情報を読み出せないよう拒否リストで防ぐ。
 */

/** ファイル名(小文字・正規化済み)に対する拒否パターン */
const SENSITIVE_BASENAMES: RegExp[] = [
  /^\.env/, // .env, .env.local, .envrc
  /\.env$/, // prod.env
  /\.(pem|key|p12|pfx|jks|keystore|ppk|kdbx)$/,
  /^id_(rsa|dsa|ecdsa|ed25519)/,
  /^(\.npmrc|\.netrc|_netrc|\.pypirc|\.git-credentials|\.pgpass|\.dockercfg)$/,
  /^\.?credentials/, // credentials, credentials.json, .credentials.json(~/.claude/.credentials.json を含む)
  /^(secrets?|client_secrets?|service[-_]?account[^/]*)\.(json|ya?ml|toml|txt)$/,
  /\.secrets?$/,
  /^\.claude\.json/, // ~/.claude.json: MCPサーバーのenv・アカウント情報
  /^claude_desktop_config\.json/, // Claude Desktop の設定: mcpServers の env に秘密情報が入りうる
]

/** どの階層に含まれていてもその配下のファイルを拒否するディレクトリ名(小文字) */
const SENSITIVE_DIR_SEGMENTS = new Set([
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".kube",
  ".docker",
  "claude-data", // Claude Desktop のデータフォルダ
  "claude-code-sessions", // Claude Desktop のセッション保存先(システムプロンプトやMCP設定のスナップショットを含む)
])

/** パス区切りを正規化してセグメントに分割する(Windows/POSIX両対応) */
function splitSegments(p: string): string[] {
  return p.split(/[\\/]+/).filter((s) => s.length > 0)
}

/**
 * Windowsは末尾のドット・空白を無視し、`name::$DATA` のようなストリーム指定でも同じファイルを開ける。
 * 拒否判定を回避されないよう、それらを取り除いたファイル名で判定する。
 */
function normalizeSegment(segment: string): string {
  const withoutStream = segment.split(":")[0]
  return withoutStream.replace(/[. ]+$/, "").toLowerCase()
}

/** 拒否対象なら理由の文字列を、許可なら null を返す */
export function getPreviewBlockReason(targetPath: string): string | null {
  const segments = splitSegments(path.resolve(targetPath)).map(normalizeSegment)
  const base = segments[segments.length - 1] ?? ""
  const dirs = segments.slice(0, -1)

  if (SENSITIVE_BASENAMES.some((re) => re.test(base))) {
    return "認証情報・秘密鍵を含む可能性があるため、このファイルはプレビューできません"
  }
  if (dirs.some((d) => SENSITIVE_DIR_SEGMENTS.has(d))) {
    return "認証情報・内部データを含むフォルダ配下のため、このファイルはプレビューできません"
  }
  // Claude Desktop の config.json(OAuthトークンを含む)。フォルダ名は Claude / Claude-Data / Claude_<パッケージID> など
  if (base === "config.json" && dirs.some((d) => /^claude([-_].*)?$/.test(d))) {
    return "Claude Desktop の設定ファイルは認証情報を含むため、プレビューできません"
  }
  // ~/.claude 配下の会話ログ(.jsonl)は会話の本文そのもの。一覧APIは先頭60文字の抜粋しか返さない方針のため、
  // 生のプレビューでも読めないようにする
  if (base.endsWith(".jsonl") && dirs.includes(".claude")) {
    return "会話ログ(.jsonl)は会話の本文を含むため、プレビューできません"
  }
  // .git/config はリモートURLにトークンが埋め込まれていることがある
  if (base === "config" && dirs[dirs.length - 1] === ".git") {
    return "Gitの設定ファイルは認証情報を含む可能性があるため、プレビューできません"
  }
  return null
}
