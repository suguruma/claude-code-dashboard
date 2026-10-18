/**
 * 他のセッションから届いたメッセージ(peer)の本文を、要約の元にする形に直す。DOM・fsに触れない純粋な関数。
 * 組織図の指示・他グループ連絡の要約(先頭20文字)と、一覧の「最新の指示」(他セッションからのもの)の両方が、この1か所を通る。
 *
 * 会話ログに残る形は、Desktopが包んだもので、定型の前置きの一文とタグが付く(文言は保証されない):
 *   Another Claude session sent a message:
 *   <cross-session-message from="…" name="…">
 *   本文…
 *
 *   送信元：…
 *   </cross-session-message>
 * 作業中に届いた分(queued_command)は、前置きが無く、タグから始まる。外部(CLI)からの分は、タグの属性が違う
 * (`from-session`・`from-mode` など)。別の包み(`<agent-message from="…">`)もある。タグだけで本文が無い形もありうる。
 */

/** 前置きの一文として許す長さ。これより長い行は、前置きではなく本文とみなす */
const PREFACE_MAX_CHARS = 120
/** `<cross-session-message` の開始タグが、先頭からこの文字数以内にあれば、その前はすべて前置きとみなす */
const CROSS_TAG_SEARCH_CHARS = 300

const CROSS_TAG = /<cross-session-message\b/
/** Desktopが付ける定型の前置き。タグが付かない形（前置きの一文と本文だけ）でも除くため、文言そのものも知っておく */
const KNOWN_PREFACE = /^Another Claude session sent a message:\s*/i
/** 先頭の開始タグ(属性の値の中の `>` は閉じとみなさない)。タグ名は包みの閉じタグを探すために取る */
const OPEN_TAG = /^<([A-Za-z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/
/** 本文の末尾に付く署名の行(「送信元：…」) */
const SIGNATURE_LINE = /^\s*送信元\s*[:：]/
/** 飾りだけの行(空行・区切り線・見出しの記号だけ) */
const DECORATION_LINE = /^[\s\-=*_~`>#]*$/

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** 先頭の前置きの一文を取り除く。前置きが無ければ、そのまま返す */
function dropPreface(text: string): string {
  // 前置きの文言は保証されないので、「cross-session-message のタグより前」はすべて前置きにする(先頭近くにあるときだけ)
  const cross = CROSS_TAG.exec(text)
  if (cross && cross.index > 0 && cross.index <= CROSS_TAG_SEARCH_CHARS) return text.slice(cross.index)
  if (text.startsWith("<")) return text
  // タグが付かない形: 定型の前置きの一文だけを除く
  const known = KNOWN_PREFACE.exec(text)
  if (known) return text.slice(known[0].length)
  // 別の包み: 「…:」で終わる短い1行のあと、タグの行が続くときだけ、その1行を前置きとみなす
  const nl = text.indexOf("\n")
  if (nl > 0 && nl <= PREFACE_MAX_CHARS) {
    const first = text.slice(0, nl).trim()
    const rest = text.slice(nl + 1).trimStart()
    if (/[:：]$/.test(first) && rest.startsWith("<")) return rest
  }
  return text
}

/** 先頭の空行・飾りの行、末尾の空行・署名の行を外し、先頭の見出し・引用の記号を外す */
function trimBody(body: string): string {
  const lines = body.split("\n")
  while (lines.length > 0 && (lines[lines.length - 1].trim() === "" || SIGNATURE_LINE.test(lines[lines.length - 1]))) lines.pop()
  while (lines.length > 0 && DECORATION_LINE.test(lines[0])) lines.shift()
  if (lines.length > 0) lines[0] = lines[0].replace(/^\s*(?:#{1,6}\s+|>\s*)+/, "")
  return lines.join("\n")
}

/** 他のセッションからのメッセージの包み(`<cross-session-message …>`)か。前置きの一文が付く形も含む */
export function isPeerMessage(raw: string): boolean {
  const text = raw.trimStart()
  const cross = CROSS_TAG.exec(text)
  return (cross !== null && cross.index <= CROSS_TAG_SEARCH_CHARS) || KNOWN_PREFACE.test(text)
}

/**
 * peer の本文から、前置きの一文・包みの開始タグ・終了タグ・末尾の署名・先頭の飾りを除いた、本文だけを返す。
 * 前置きもタグも無い形(古い形式)は、本文のまま(先頭の飾りと末尾の署名だけ外す)。タグだけなら空文字。
 */
export function peerBodyOf(raw: string): string {
  let text = dropPreface(raw.replace(/\r\n?/g, "\n").trimStart())
  const open = OPEN_TAG.exec(text)
  if (open) {
    text = text.slice(open[0].length)
    text = text.replace(new RegExp(`\\s*</${escapeRegExp(open[1])}\\s*>\\s*$`), "")
  }
  return trimBody(text)
}
