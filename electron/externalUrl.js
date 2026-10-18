/**
 * 既定のブラウザ・他のアプリで開いてよいURLの判定。レンダラー(ページ)から渡されたURLをそのまま
 * shell.openExternal に渡すと、任意のアプリやファイルを起動できてしまうため、許可するURLを狭く限る。
 *
 * 許可するのは、Claude Desktopでセッションを開く `claude://claude.ai/epitaxy/local_<ID>` だけ。
 * スキームが claude: であることに加えて、ホスト・パス・セッションIDの形式まで完全に一致するものに限る
 * (src/lib/sessionMessaging.ts の sessionDeepLink が作る形式)。
 */
const ALLOWED_EXTERNAL_URL = /^claude:\/\/claude\.ai\/epitaxy\/local_[A-Za-z0-9_-]{1,100}$/

function isAllowedExternalUrl(url) {
  return typeof url === "string" && url.length <= 200 && ALLOWED_EXTERNAL_URL.test(url)
}

module.exports = { isAllowedExternalUrl }
