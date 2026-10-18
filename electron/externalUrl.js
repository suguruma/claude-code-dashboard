/**
 * 既定のブラウザ・他のアプリで開いてよいURLの判定。レンダラー(ページ)から渡されたURLをそのまま
 * shell.openExternal に渡すと、任意のアプリやファイルを起動できてしまうため、許可するURLを狭く限る。
 * 許可するURLは、このファイルの ALLOWED_EXTERNAL_URLS の1か所だけに書く(ここに無いURLは、どの経路からも開かない)。
 *
 * 許可しているのは次の2種類で、どちらも「完全に一致するもの」に限る(前方一致や部分一致は許さない)。
 * - Claude Desktopでセッションを開く `claude://claude.ai/epitaxy/local_<ID>`
 *   (スキームが claude: であることに加えて、ホスト・パス・セッションIDの形式まで一致するもの。
 *   src/lib/sessionMessaging.ts の sessionDeepLink が作る形式)
 * - ヘルプページが案内する Claude Code の紹介ページ `https://claude.com/claude-code`
 */
const ALLOWED_EXTERNAL_URLS = [
  /^claude:\/\/claude\.ai\/epitaxy\/local_[A-Za-z0-9_-]{1,100}$/,
  /^https:\/\/claude\.com\/claude-code$/,
]

function isAllowedExternalUrl(url) {
  return typeof url === "string" && url.length <= 200 && ALLOWED_EXTERNAL_URLS.some((pattern) => pattern.test(url))
}

module.exports = { isAllowedExternalUrl }
