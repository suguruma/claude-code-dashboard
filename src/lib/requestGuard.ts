/**
 * /api/* への要求を「このマシン上のダッシュボード画面からの要求」に限定するための検証ロジック。
 *
 * 認証の無いローカル専用APIなので、次の3経路を塞ぐ。
 * - DNS rebinding: 攻撃者ドメインが127.0.0.1に解決される場合、Hostが攻撃者ドメインになるため拒否する
 * - クロスサイトからの書き込み(CSRF): Origin が Host と一致しない書き込みは拒否する
 * - フォーム経由の単純リクエスト: ボディ付きの書き込みは application/json のみ受け付ける
 *
 * Origin を持たない要求(curl等の非ブラウザ)は、同一マシンのプロセスであり、ブラウザ経由の攻撃ではないため許可する。
 * ただしブラウザが付ける Sec-Fetch-Site が same-origin/none 以外の書き込みは拒否する。
 */

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

/** Host として許可するのはループバックの名前のみ。ポートは任意(exeは起動ごとにランダムなポートを使うため) */
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/i

export interface GuardInput {
  method: string
  host: string | null
  origin: string | null
  secFetchSite: string | null
  contentType: string | null
  contentLength: string | null
  transferEncoding: string | null
}

export type GuardResult =
  | { ok: true }
  | { ok: false; status: 403 | 415; message: string }

function reject(status: 403 | 415, message: string): GuardResult {
  return { ok: false, status, message }
}

function hasBody(input: GuardInput): boolean {
  if (input.transferEncoding) return true
  if (input.contentLength === null) return false
  return input.contentLength.trim() !== "0"
}

export function checkApiRequest(input: GuardInput): GuardResult {
  const host = input.host?.trim() ?? ""
  if (!LOOPBACK_HOST.test(host)) {
    return reject(403, "許可されていないHostです")
  }

  if (input.origin !== null) {
    let originHost: string
    try {
      const url = new URL(input.origin)
      originHost = url.host
    } catch {
      // "null" など解釈できないOriginは、サンドボックスiframe・file:// 等からの要求とみなして拒否する
      return reject(403, "許可されていないOriginです")
    }
    if (originHost.toLowerCase() !== host.toLowerCase()) {
      return reject(403, "許可されていないOriginです")
    }
  }

  const method = input.method.toUpperCase()
  if (WRITE_METHODS.has(method)) {
    if (input.origin === null && input.secFetchSite !== null) {
      const site = input.secFetchSite.toLowerCase()
      if (site !== "same-origin" && site !== "none") {
        return reject(403, "クロスサイトからの書き込みは許可されていません")
      }
    }
    if (hasBody(input) && !/^application\/json\s*(;|$)/i.test(input.contentType?.trim() ?? "")) {
      return reject(415, "書き込み要求のContent-Typeはapplication/jsonのみ対応しています")
    }
  }

  return { ok: true }
}
