/**
 * 秘密らしい文字列を伏せる(⑬ ND-5・A5)。許可を待つコマンドの先頭などを画面に出す前に通す。
 * 伏せる前に切ると、秘密の一部が残るので、必ず伏せてから切る(cutAfterMask)。
 * サーバー専用モジュールを import しない(画面とサーバーで同じ規則を使うため)。
 * 取りこぼしを前提に、安全側に倒す：秘密らしい名前のあとの `=`・`:` の右は、値を丸ごと伏せる(ゲート2 の M1)。
 */

export const SECRET_MARK = "●●●●"

/** 名前に含まれていたら秘密とみなす語。前後に英数字・`_`・`-` が付いてもよい(DB_PASSWORD・API_TOKEN・AWS_SECRET_ACCESS_KEY・MYSQL_PWD) */
const SECRET_NAME = String.raw`(?:password|passwd|passphrase|pwd|token|secret|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credentials?)`
/** 名前の前後に付いてよい文字(\b は `_` を語の文字とみなすので使わない) */
const NAME_PART = String.raw`[A-Za-z0-9_-]*`
/** 値：引用符で囲んだもの、または空白・&・引用符までの続き */
const VALUE = String.raw`("[^"]*"|'[^']*'|[^\s&"']+)`
/**
 * -p でパスワードを取るコマンド。前が英数字・`_`・`-`・`.` でなければよい(文章の中の「`…`」「（…）」「：」の後ろや、
 * `/usr/bin/mysql`・`C:\…\mysql.exe` のようなパスつきでも効くように。⑭ のゲート2 の M2)
 */
const PW_COMMAND = String.raw`(?<![\w.-])(?:mysql\w*|mariadb[\w-]*|sshpass|mongo\w*)(?:\.exe)?\b`

/** 上から順に置き換える。先に「名前つき」の形を伏せ、最後に長い英数字の塊を伏せる */
const SECRET_PATTERNS: Array<{ pattern: RegExp; replace: string }> = [
  // Authorization: Bearer xxx / Authorization=xxx
  { pattern: /(authorization\s*[:=]\s*)(?:(?:bearer|basic|token)\s+)?("[^"]*"|'[^']*'|\S+)/gi, replace: `$1${SECRET_MARK}` },
  // Bearer xxx(Authorization の無い形)
  { pattern: /(^|[^A-Za-z0-9])(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, replace: `$1$2${SECRET_MARK}` },
  // URL の中の資格(https://user:pass@host)。パスワードの部分を伏せる
  { pattern: /([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s@/]+@/gi, replace: `$1${SECRET_MARK}@` },
  // curl -u user:pass・--user user:pass・--user=user:pass
  { pattern: /((?:^|\s)(?:-u|--user)(?:\s+|=)[^\s:]+:)\S+/g, replace: `$1${SECRET_MARK}` },
  // JSON の "password":"…"・"api_key": 123 など(名前を引用符で囲んだ形)
  {
    pattern: new RegExp(String.raw`("${NAME_PART}${SECRET_NAME}${NAME_PART}"\s*:\s*)("(?:[^"\\]|\\.)*"|[^\s,}\]]+)`, "gi"),
    replace: `$1"${SECRET_MARK}"`,
  },
  // --password 値・--token=値・--api-key 値 など(空白でも = でも)
  {
    pattern: new RegExp(String.raw`((?:^|\s)--?${NAME_PART}${SECRET_NAME}${NAME_PART}(?:\s+|=))${VALUE}`, "gi"),
    replace: `$1${SECRET_MARK}`,
  },
  // -p でパスワードを取るコマンド(mysql・mariadb・sshpass・mongo)の -pパスワード(続けて書く形)と、-p の次の語(数字とポートの形は除く)。
  // ほかのコマンドの -p(rg -p・mkdir -pv・docker -p 8080:80)は値を取らないかポートなので伏せない(ゲート2 の L7)
  { pattern: new RegExp(String.raw`(${PW_COMMAND}[^;&|\n]*?\s-p)(?=\S*[A-Za-z!@#$%^&*'"])\S+`, "g"), replace: `$1${SECRET_MARK}` },
  // 次の語は英数字・記号で始まるものだけ(「mysql の -p は値を取る」のような文の続きは伏せない)
  { pattern: new RegExp(String.raw`(${PW_COMMAND}[^;&|\n]*?\s-p\s+)(?!\d+(?::\d+)?(?:\s|$))(?!-)(?=[\x21-\x7e])\S+`, "g"), replace: `$1${SECRET_MARK}` },
  // redis-cli の -a パスワードと、その別名の --pass(ゲート2 の L6・M2)
  { pattern: /((?<![\w.-])redis-cli(?:\.exe)?\b[^;&|\n]*?\s(?:-a\s+|--pass(?:\s+|=)))(?!-)\S+/g, replace: `$1${SECRET_MARK}` },
  // DB_PASSWORD=…・SECRET_KEY=…・token: … など(名前の前後に文字が付いてもよい。= か : の右を丸ごと)
  {
    pattern: new RegExp(String.raw`(${NAME_PART}${SECRET_NAME}${NAME_PART}\s*[=:]\s*)${VALUE}`, "gi"),
    replace: `$1${SECRET_MARK}`,
  },
  // 日本語の「パスワードは…」「トークン：…」
  { pattern: /((?:パスワード|暗証番号|トークン|シークレット|秘密鍵)(?:は|が|を|:|：|=)\s*)[^\s、。,]+/g, replace: `$1${SECRET_MARK}` },
  // よく使われる鍵の形(sk-…・ghp_…・github_pat_…・xoxb-… など)
  { pattern: /(?<![A-Za-z0-9])(?:sk|pk|rk|ghp|gho|ghu|ghs|ghr|github_pat|xox[abpr])[-_][A-Za-z0-9_-]{8,}/g, replace: SECRET_MARK },
  // 24文字以上の英数字の塊(鍵・トークンらしいもの)
  { pattern: /[A-Za-z0-9+_-]{24,}={0,2}/g, replace: SECRET_MARK },
]

export function maskSecrets(text: string): string {
  let out = text
  for (const { pattern, replace } of SECRET_PATTERNS) out = out.replace(pattern, replace)
  return out
}

/** 空白をつめ、秘密らしい文字列を伏せてから、maxChars で切る(切ったときは末尾に「…」) */
export function cutAfterMask(text: string, maxChars: number): string {
  const masked = maskSecrets(text.replace(/\s+/g, " ").trim())
  return masked.length > maxChars ? `${masked.slice(0, maxChars)}…` : masked
}
