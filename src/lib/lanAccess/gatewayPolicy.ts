/**
 * LAN の入り口(gateway.ts)が、要求をどう扱うかの判定(純粋な関数)。
 *
 * Next のサーバーは 127.0.0.1 だけで待ち受け、LAN からはこの入り口だけを通す。Next の proxy では相手のアドレスが
 * 分からず、Host を偽るだけでループバック扱いになるため(要件メモ ⑪ の3章)。判定の順番:
 * 1. Host が「この PC のプライベートな IPv4:入り口の番号」でなければ 403(DNS rebinding)
 * 2. GET・HEAD 以外は 403(鍵の有無を見る前に断る。書き込みは PC からだけ)
 * 3. パスの書き方がおかしい(`..`・`%`・`\`)ものは 403
 * 4. 接続の切り替え(WebSocket など)は 403。例外は、開発のサーバー(next dev)の画面の更新の通知(`/_next/webpack-hmr`)を、
 *    登録した端末から開くときだけ(開発のサーバーの画面は、これがつながらないと「読み込み中」のまま止まるため)
 * 5. `/pair?code=…` は、入り口の中で登録する(Next へは渡さない)
 * 6. 有効な端末の鍵が無ければ 401(ページは登録の案内、API は JSON)
 * 7. 許可リストに無いパスは 403
 * 8. ここまで通ったものだけを、127.0.0.1 の Next へ中継する
 */

const READ_METHODS = new Set(["GET", "HEAD"])

/** LAN の入り口が、中継した要求に付ける印。Next の側は、これでスマホ用のページに振り替え、API の応答のパスを隠す */
export const LAN_HEADER = "x-ccd-via-lan"

/** 開発のサーバーの、画面の更新の通知(WebSocket) */
export const DEV_HMR_PATH = "/_next/webpack-hmr"

/** LAN から見られるページ(Claude Desktop の4ページ) */
export const LAN_PAGES = ["/", "/desktop-sessions", "/desktop-sessions/usage", "/desktop-sessions/housekeeping"] as const

/** LAN から読める API(4ページが使う GET だけ) */
const LAN_APIS = new Set([
  "/api/desktop-sessions",
  "/api/desktop-sessions/flow",
  "/api/desktop-sessions/housekeeping",
  "/api/desktop-sessions/settings",
  "/api/usage",
])
/**
 * `/api/desktop-sessions/<セッションID>`(詳細)。ID は Desktop の識別子(`local_…`)か、会話ログだけの縮退表示の UUID だけ。
 * 英数字なら何でも通す形にすると、あとで `/api/desktop-sessions/` の下に足した API(書き出しなど)まで、スマホに開いてしまうため
 */
const SESSION_DETAIL = /^\/api\/desktop-sessions\/(?:local_[A-Za-z0-9_-]{1,100}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/

export function isAllowedLanPath(pathname: string): boolean {
  if ((LAN_PAGES as readonly string[]).includes(pathname)) return true
  if (LAN_APIS.has(pathname) || SESSION_DETAIL.test(pathname)) return true
  if (pathname.startsWith("/_next/static/")) return true
  return pathname === "/favicon.ico"
}

/** 画面の部品(JS・CSS・フォント)の置き場所 */
const STATIC_PREFIX = "/_next/static/"
/** 開発のサーバー(Turbopack)が next/font のフォントを置く場所。開発のときだけ通す(本番は /_next/static/ の下) */
const DEV_FONT = /^\/__nextjs_font\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/
/**
 * 部品の名前の中で、`%` で書いてよい文字。開発のサーバー(Turbopack)は、部品の名前の `@`・`[`・`]` などを `%40`・`%5B`・`%5D` と書く
 * (例: `node_modules_%40base-ui_…`・`%5Broot-of-the-server%5D__….css`)
 */
const STATIC_ESCAPABLE = new Set(["@", "[", "]", "+", "!", "$", "&", "'", "(", ")", ",", ";", "=", "~"])

/** `/_next/static/` の下の `%` の書き方が、決まった文字に戻るものだけか(`/`・`\`・`.`・`%`・制御文字に戻るものは不可) */
function isSafeStaticEscape(rawPath: string): boolean {
  if (!rawPath.startsWith(STATIC_PREFIX)) return false
  const escapes = rawPath.match(/%[0-9A-Fa-f]{2}/g) ?? []
  // `%` の後ろが16進の2文字でないもの(`%zz`・末尾の `%`)は不可
  if (escapes.length !== (rawPath.match(/%/g) ?? []).length) return false
  for (const e of escapes) {
    if (!STATIC_ESCAPABLE.has(String.fromCharCode(parseInt(e.slice(1), 16)))) return false
  }
  const decoded = decodeURIComponent(rawPath)
  return !decoded.includes("..") && !/[%\\\u0000-\u001f\u007f]/.test(decoded)
}

/**
 * パスと問い合わせを分ける。`..` で上がる・`%` で書く・`\` を含む書き方は、正規化の食い違いを避けるため受け付けない。
 * 例外は `/_next/static/` の下で、決まった文字に戻る `%` だけ(中継するときは、元の書き方のまま渡す)
 */
export function parseLanPath(rawUrl: string): { pathname: string; search: string } | null {
  if (!rawUrl.startsWith("/") || rawUrl.startsWith("//") || rawUrl.includes("\\")) return null
  const q = rawUrl.indexOf("?")
  const rawPath = q === -1 ? rawUrl : rawUrl.slice(0, q)
  if (rawPath.includes("%") && !isSafeStaticEscape(rawPath)) return null
  let url: URL
  try {
    url = new URL(rawUrl, "http://lan.invalid")
  } catch {
    return null
  }
  if (url.pathname !== rawPath) return null
  return { pathname: url.pathname, search: url.search }
}

export interface LanPolicyInput {
  method: string
  host: string | null
  rawUrl: string
  isUpgrade: boolean
  /** この PC のプライベートな IPv4 アドレス(要求のたびに求めたもの) */
  localAddresses: string[]
  port: number
  /** クッキーの鍵が、有効な端末(取り消していない・期限内)のものか */
  deviceValid: boolean
  /** 開発のサーバー(next dev)で動いているか。true のときだけ、画面の更新の通知の WebSocket を通す */
  devHmr?: boolean
  /** 開発のサーバーで動いているか(ふつうの要求の経路)。true のときだけ、開発のフォントの置き場所(`/__nextjs_font/`)を通す */
  devAssets?: boolean
}

export type LanPolicyResult =
  | { action: "reject"; status: 403; reason: string }
  | { action: "pair"; code: string | null }
  | { action: "needKey"; api: boolean }
  | { action: "forward"; pathname: string; search: string }
  | { action: "upgrade"; pathname: string; search: string }

function reject(reason: string): LanPolicyResult {
  return { action: "reject", status: 403, reason }
}

export function decideLanRequest(input: LanPolicyInput): LanPolicyResult {
  const host = (input.host ?? "").trim().toLowerCase()
  if (!input.localAddresses.some((addr) => host === `${addr}:${input.port}`)) return reject("許可されていないHostです")
  if (!READ_METHODS.has(input.method.toUpperCase())) return reject("スマホからは読み取りだけです（書き込みは PC からだけ）")
  const parsed = parseLanPath(input.rawUrl)
  if (!parsed) return reject("許可されていないパスです")
  if (input.isUpgrade) {
    const devHmr = input.devHmr === true && input.method.toUpperCase() === "GET" && parsed.pathname === DEV_HMR_PATH && input.deviceValid
    return devHmr ? { action: "upgrade", pathname: parsed.pathname, search: parsed.search } : reject("接続の切り替えは受け付けません")
  }
  if (parsed.pathname === "/pair") return { action: "pair", code: new URLSearchParams(parsed.search).get("code") }
  if (!input.deviceValid) return { action: "needKey", api: parsed.pathname.startsWith("/api/") }
  const devFont = input.devAssets === true && DEV_FONT.test(parsed.pathname) && !parsed.pathname.includes("..")
  if (!isAllowedLanPath(parsed.pathname) && !devFont) return reject("スマホからは見られないページです")
  return { action: "forward", pathname: parsed.pathname, search: parsed.search }
}

/** クッキーの文字列から、名前の合う値を1つ取り出す */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(";")) {
    const i = part.indexOf("=")
    if (i === -1) continue
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null
  }
  return null
}
