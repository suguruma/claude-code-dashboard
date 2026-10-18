const { isAllowedExternalUrl } = require("./externalUrl")

/**
 * アプリのウィンドウが開いてよい移動先と、IPCを受け付ける送り元の判定。electron に依存しない純粋な関数だけを置く
 * (main.js が使う。判定そのものを単体でテストできるようにするため)。
 *
 * アプリのオリジンは、この起動で決まったポートの `http://127.0.0.1:<ポート>` ひとつだけ。
 * 比較は URL を解析したうえでの厳密な一致で、前方一致は使わない
 * (`http://127.0.0.1:<ポート>.example` や `http://127.0.0.1:<ポート>@example` を取り違えないため)。
 */

/** ポートからアプリのオリジンを作る。ポートが正しくなければ null（そのときは何も許可しない） */
function appOriginOf(port) {
  return Number.isInteger(port) && port > 0 && port <= 65535 ? `http://127.0.0.1:${port}` : null
}

/**
 * URLがアプリのオリジン内か。解析できないURL・appOrigin が無いときは false。
 * blob: のURLは、origin が中身のURLのものになる（blob:http://127.0.0.1:<ポート>/… は origin が一致してしまう）ので、
 * スキームが http: であることも確かめる。
 */
function isAppUrl(url, appOrigin) {
  if (typeof url !== "string" || !appOrigin) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" && parsed.origin === appOrigin
  } catch {
    return false
  }
}

/**
 * 移動・新しい窓の行き先の判定。
 * - "allow": アプリのオリジン内（移動してよい）
 * - "external": 許可リスト（externalUrl.js）にある外部URL。窓では開かず、既定のアプリ・ブラウザで開く
 * - "block": それ以外。移動も新しい窓も止める
 */
function navigationDecision(url, appOrigin) {
  if (isAppUrl(url, appOrigin)) return "allow"
  if (isAllowedExternalUrl(url)) return "external"
  return "block"
}

/**
 * IPCの送り元が、本アプリのメインウィンドウのメインフレームで、そのページのオリジンがアプリのものか。
 * event.senderFrame が無い（フレームが破棄された）ときは false。
 */
function isTrustedIpcEvent(event, mainWebContents, appOrigin) {
  if (!event || !mainWebContents || event.sender !== mainWebContents) return false
  const frame = event.senderFrame
  if (!frame) return false
  // メインフレームだけを許す（子フレームには parent がある）
  if (frame.parent != null) return false
  return isAppUrl(frame.url, appOrigin)
}

module.exports = { appOriginOf, isAppUrl, navigationDecision, isTrustedIpcEvent }
